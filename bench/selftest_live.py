"""Autonomous live self-test of the Quartet loop.

Brings up the local stack (llama-server + the four Band agents) with telemetry enabled, drives ONE
easy HumanEval problem through the conductor with full tracing, reads the shared JSONL event stream
to decide PASS/FAIL on five checks, prints a per-agent report, and tears down only what it started.

Answers one question: is the multi-agent loop doing real work end to end?

Run: uv run python -m bench.selftest_live
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from bench.events import analyze, read_events

MODEL = "/home/amnesia/ai_models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
PORT = 8080
BASE = f"http://localhost:{PORT}"
ROLES = ["spec", "coder", "tester", "repairer"]
TASK = "HumanEval/0"
SELFTEST_DIR = Path("results/selftest")
EVENTS_DIR = Path("results/events")
CHECK_LABELS = {
    "four_agents_connected": "1. all four agents connected",
    "each_agent_llm_and_post": "2. each agent made >=1 llm_call and >=1 post",
    "run_tests_ran": "3. run_tests ran with a real result",
    "repairer_terminal_at_conductor": "4. Repairer terminal mentioned @Conductor",
    "conductor_scored": "5. conductor emitted scored (boolean)",
}


def _http_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def _wait_until(predicate, timeout: float, poll: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(poll)
    return False


def _kill(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass


def ensure_llama() -> subprocess.Popen | None:
    """Start llama-server if :8080 is not already serving. Returns the proc we started, else None."""
    if _http_ok(f"{BASE}/v1/models"):
        print(f"[stack] llama-server already serving on :{PORT}; reusing it")
        return None
    # --jinja is required so llama.cpp parses the model's tool calls into OpenAI tool_calls; without
    # it the agents' band_send_message calls are returned as plain text and nothing reaches the room.
    cmd = ["llama-server", "-m", MODEL, "--host", "127.0.0.1", "--port", str(PORT), "-c", "8192", "-ngl", "99", "--jinja"]
    print(f"[stack] starting llama-server: {' '.join(cmd)}")
    log = open(SELFTEST_DIR / "llama.log", "w")
    proc = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    ready = _wait_until(lambda: _http_ok(f"{BASE}/health") or _http_ok(f"{BASE}/v1/models"), timeout=240)
    if not ready:
        raise RuntimeError("llama-server did not become ready in 240s; see results/selftest/llama.log")
    print("[stack] llama-server ready")
    return proc


def start_agents(env: dict) -> dict:
    """Start the four agents as background processes; wait for each to log 'connected'."""
    procs = {}
    for role in ROLES:
        log = open(SELFTEST_DIR / f"{role}.log", "w")
        proc = subprocess.Popen(
            [sys.executable, "-m", f"agents.{role}"],
            stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True,
        )
        procs[role] = proc
        print(f"[stack] started agent {role} (pid {proc.pid})")
    for role in ROLES:
        logpath = SELFTEST_DIR / f"{role}.log"
        ok = _wait_until(lambda lp=logpath: "connected" in lp.read_text(errors="replace"), timeout=90)
        print(f"[stack] agent {role}: {'connected' if ok else 'DID NOT CONNECT in 90s'}")
    return procs


def run_conductor(env: dict) -> Path:
    out = SELFTEST_DIR / "quartet_selftest.json"
    cmd = [
        sys.executable, "-m", "orchestrator.conductor",
        "--task", TASK, "--trace", "--timeout", "600", "--settle", "5", "--out", str(out),
    ]
    print(f"\n[run] {' '.join(cmd)}\n")
    subprocess.run(cmd, env=env, check=False)
    return out


def _epoch(iso: str | None) -> float | None:
    try:
        return datetime.fromisoformat(iso).timestamp()
    except (TypeError, ValueError):
        return None


def _tail(path: Path, n: int = 15) -> str:
    try:
        return "\n".join(path.read_text(errors="replace").splitlines()[-n:])
    except FileNotFoundError:
        return "(no log)"


def report(events_path: str, out_json: Path, wall_s: float) -> bool:
    events = read_events(events_path)
    a = analyze(events)
    by_role = a["by_role"]

    first_post: dict = {}
    for ev in events:
        if ev.get("type") == "message_posted":
            role = ev.get("role")
            if role and role not in first_post:
                first_post[role] = (ev.get("ts"), ev.get("preview", ""))

    print("\n================ Quartet live self-test report ================")
    print(f"task: {TASK}   wall: {wall_s:.1f}s   events: {events_path}")

    print("\n-- per agent --")
    for role in ROLES:
        r = by_role.get(role, {})
        spoke = "yes" if r.get("posts", 0) > 0 else "no"
        print(f"  {role:9} spoke={spoke:3} llm_calls={r.get('llm_calls', 0)} "
              f"tokens={r.get('tokens', 0)} posts={r.get('posts', 0)} received={r.get('received', 0)}")

    print("\n-- run_tests --")
    tcs = a["tool_calls"]
    if tcs:
        for tc in tcs:
            print(f"  ran: {tc.get('args_summary')} -> {tc.get('result')} ({tc.get('duration_ms')}ms)")
    else:
        print("  did NOT run")

    # Harvested solution + official score from the conductor results json.
    rec = {}
    try:
        data = json.loads(out_json.read_text())
        rec = (data.get("results") or [{}])[0]
    except (FileNotFoundError, json.JSONDecodeError, IndexError):
        pass
    print("\n-- harvested solution --")
    print(f"  status: {rec.get('status')}   official passed: {rec.get('passed')}   error: {rec.get('error')}")
    sol = (rec.get("solution") or "").strip()
    if sol:
        for line in sol.splitlines()[:12]:
            print(f"    | {line}")

    print("\n-- per-stage timing (first post of each role) --")
    t0 = _epoch(first_post.get("conductor", (None,))[0])
    prev_label, prev_t = "conductor-post", t0
    for role in ROLES:
        ts = _epoch(first_post.get(role, (None,))[0])
        if ts is None or prev_t is None:
            print(f"  {role:9} (no post)")
            continue
        print(f"  {prev_label:14} -> {role:9} +{ts - prev_t:.1f}s")
        prev_label, prev_t = role, ts

    print("\n-- first words from each agent --")
    for role in ROLES:
        if role in first_post:
            print(f"  {role:9}: {first_post[role][1][:160]}")
        else:
            print(f"  {role:9}: (silent) log tail:")
            print("    " + _tail(SELFTEST_DIR / f"{role}.log").replace("\n", "\n    "))

    print("\n-- checks --")
    checks = a["checks"]
    for key, label in CHECK_LABELS.items():
        print(f"  [{'PASS' if checks.get(key) else 'FAIL'}] {label}")

    verdict = all(checks.values())
    print("\n================================================================")
    print(f"VERDICT: multi-agent loop doing real work end to end? {'YES' if verdict else 'NO'}")
    print("================================================================")
    return verdict


def main() -> None:
    SELFTEST_DIR.mkdir(parents=True, exist_ok=True)
    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
    events_path = str(EVENTS_DIR / f"{run_id}.jsonl")
    env = {**os.environ, "LLM_PROVIDER": "local", "QUARTET_RUN_ID": run_id, "QUARTET_EVENTS_PATH": events_path}
    print(f"[stack] run_id={run_id}")

    llama = None
    agents: dict = {}
    started = time.monotonic()
    try:
        llama = ensure_llama()
        agents = start_agents(env)
        run_conductor(env)
        verdict = report(events_path, SELFTEST_DIR / "quartet_selftest.json", time.monotonic() - started)
        sys.exit(0 if verdict else 1)
    finally:
        print("\n[stack] tearing down processes the runner started...")
        for role, proc in agents.items():
            _kill(proc)
            print(f"[stack] stopped agent {role}")
        if llama is not None:
            _kill(llama)
            print("[stack] stopped llama-server")
        else:
            print("[stack] left the pre-existing llama-server running")


if __name__ == "__main__":
    main()
