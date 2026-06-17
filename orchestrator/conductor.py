"""Conductor: drives the Quartet over the benchmark through Band.

The conductor is a scripted Agent-API client (a 5th "Conductor" agent), not an LLM agent. Per
problem it opens a room, adds the four agents, posts the problem mentioning @Spec, then reads the
room conversation via the agent context endpoint (logging a who-spoke-when trace) and harvests the
Repairer's terminal message (FINAL_SOLUTION + block, or NO_SOLUTION) to score the solution against
the held-out official test. The agents never see the official test; the conductor holds it for
scoring only.

The Human API is Enterprise-only and 403s on Pro, so everything here uses the agent_api_*
resources, authenticated with the conductor's agent API key (sent as X-API-Key by RestClient).

Run: uv run python -m orchestrator.conductor [--n N | --task ID] [--timeout S] [--poll S]
     [--trace] [--out PATH] [--selftest]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from band import BandConnectionError
from band.client.rest import (
    ChatMessageRequest,
    ChatMessageRequestMentionsItem,
    ChatRoomRequest,
    ParticipantRequest,
    RestClient,
)

from bench.events import emit, read_events
from bench.sandbox import run_tests
from orchestrator.config import BAND_REST_URL, get_agent
from orchestrator.run_config import models_map

_MENTION = re.compile(r"@\[\[[^\]]+\]\]|@\w+")

# Order matters: Spec is mentioned to start; the four are added as room participants.
ROLES = ["spec", "coder", "tester", "repairer"]

_RETRY_BACKOFF = 2.0
_DEFAULT_OUT = "results/quartet_local.json"

# Terminal detection, hardened for small models that mention the tokens mid-thought: the token
# must start a line, and FINAL_SOLUTION is terminal only when a python block follows it.
_FINAL = re.compile(r"^[ \t]*FINAL_SOLUTION\b", re.MULTILINE)
_NONE = re.compile(r"^[ \t]*NO_SOLUTION\b", re.MULTILINE)
_BLOCK = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)


def _extract_solution(text: str) -> str:
    """Return the python block following a line-anchored FINAL_SOLUTION token, else ''."""
    m = _FINAL.search(text)
    if not m:
        return ""
    blk = _BLOCK.search(text, m.end())
    return blk.group(1).strip() if blk else ""


def classify(text: str) -> tuple[str | None, str]:
    """Classify a message: ('FINAL_SOLUTION', code) | ('NO_SOLUTION', '') | (None, '').

    FINAL_SOLUTION wins, but only when it carries a python block. A bare or mid-sentence mention
    is not terminal, so the caller keeps polling.
    """
    solution = _extract_solution(text)
    if solution:
        return "FINAL_SOLUTION", solution
    if _NONE.search(text):
        return "NO_SOLUTION", ""
    return None, ""


def _mentions_conductor(msg, conductor_id: str) -> bool:
    """True if a message addresses the Conductor: literal @Conductor, the normalized mention token
    @[[<id>]], or the id in metadata. A terminal is accepted only when this holds, so a repair-round
    message to @Coder that merely contains FINAL_SOLUTION/NO_SOLUTION is not harvested as the final
    answer (a silent false-terminal would corrupt the score)."""
    content = msg.content or ""
    if re.search(r"@conductor\b", content, re.IGNORECASE):
        return True
    if conductor_id and f"@[[{conductor_id}]]" in content:
        return True
    meta = getattr(msg, "metadata", None)
    return bool(conductor_id and meta and conductor_id in str(meta))


def make_client() -> RestClient:
    """Build the Agent-API REST client authenticated as the Conductor agent. Never logs the key."""
    cfg = get_agent("conductor")
    return RestClient(base_url=BAND_REST_URL, api_key=cfg["api_key"])


def _with_retry(fn, *args, **kwargs):
    """Call fn, retrying once on a transport error (not on HTTP status errors)."""
    try:
        return fn(*args, **kwargs)
    except (httpx.TransportError, BandConnectionError) as e:
        logging.warning("transport error (%s); retrying once", type(e).__name__)
        time.sleep(_RETRY_BACKOFF)
        return fn(*args, **kwargs)


def _msg_ts(msg) -> float:
    ts = getattr(msg, "inserted_at", None)
    return ts.timestamp() if ts else 0.0


def _iso_to_epoch(s: str | None) -> float | None:
    try:
        return datetime.fromisoformat(s).timestamp()
    except (TypeError, ValueError):
        return None


def write_transcript(client: RestClient, room_id: str, task_id: str) -> None:
    """Write the full room transcript (every message, full content) with run_tests tool calls
    interleaved by timestamp to results/selftest/<task_id>_transcript.md. Local debug artifact."""
    resp = _with_retry(client.agent_api_context.get_agent_chat_context, room_id, page_size=100)
    msgs = sorted(resp.data, key=_msg_ts)
    items: list[tuple[float, str, object]] = [(_msg_ts(m), "msg", m) for m in msgs]

    # Interleave this run's run_tests tool_call events (they carry no room_id, so include any that
    # land at or after the room's first message; for a single-problem trace this is exact).
    lo = _msg_ts(msgs[0]) if msgs else 0.0
    events_path = os.environ.get("QUARTET_EVENTS_PATH")
    if events_path:
        for ev in read_events(events_path):
            if ev.get("type") != "tool_call":
                continue
            ts = _iso_to_epoch(ev.get("ts"))
            if ts is not None and ts >= lo:
                items.append((ts, "tool", ev))
    items.sort(key=lambda x: x[0])

    lines = [f"# Transcript: {task_id}", "", f"Room: `{room_id}`", ""]
    for _ts, kind, obj in items:
        if kind == "msg":
            who = obj.sender_name or obj.sender_id
            lines.append(f"### [{who}] ({obj.sender_type})")
            lines.append("")
            lines.append(obj.content or "")
            lines.append("")
        else:
            r = obj.get("result", {})
            lines.append(f"### run_tests (tool / {obj.get('role')})")
            lines.append("")
            lines.append(f"args: {obj.get('args_summary')}  ->  result: {r}  ({obj.get('duration_ms')}ms)")
            lines.append("")

    out = Path("results/selftest") / f"{task_id.replace('/', '_')}_transcript.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    logging.info("[%s] transcript -> %s", task_id, out)


def _transcript_messages(msgs) -> list[dict]:
    """Turn raw room messages into the transcript's message list (full bodies, no keys)."""
    out = []
    for m in sorted(msgs, key=_msg_ts):
        sender = m.sender_name or m.sender_id or "unknown"
        content = m.content or ""
        status, _ = classify(content)
        inserted = getattr(m, "inserted_at", None)
        out.append({
            "ts": inserted.isoformat() if inserted else None,
            "role": sender.lower(),
            "sender": sender,
            "sender_type": str(getattr(m, "sender_type", "") or ""),
            "content": content,
            "mentions": _MENTION.findall(content),
            "kind": status,
        })
    return out


def _save_transcript(run_id: str, task_id: str, room_id: str, prompt: str, solution: str, msgs) -> None:
    """Write results/transcripts/<run_id>.json from the given room messages. Called incrementally
    during the run (so the reasoning panel fills live) and once more at the end with the solution."""
    if not run_id:
        return
    out = {
        "run_id": run_id,
        "task_id": task_id,
        "room_id": room_id,
        "prompt": prompt,
        "final_solution": solution,
        "messages": _transcript_messages(msgs),
    }
    path = Path("results/transcripts") / f"{run_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))


def write_transcript_json(client: RestClient, room_id: str, task_id: str, problem: dict, solution: str) -> None:
    """Persist the full room transcript (every message, full body) to results/transcripts/<run_id>.json.

    This is the source for the demo's reasoning panel: the event stream keeps only 200-char previews,
    so full agent reasoning lives here instead. Local artifact, the user's own agent output, no keys.
    """
    run_id = os.environ.get("QUARTET_RUN_ID", "")
    resp = _with_retry(client.agent_api_context.get_agent_chat_context, room_id, page_size=100)
    _save_transcript(run_id, task_id, room_id, problem.get("prompt", ""), solution, resp.data)
    logging.info("[%s] reasoning transcript -> results/transcripts/%s.json", task_id, run_id)


def open_room(client: RestClient, problem: dict, agent_ids: dict) -> str:
    """Create a room for the problem and add the four agents as participants."""
    # Band's task_id must be a UUID for an existing task; the HumanEval id ("HumanEval/81") is
    # neither, so we omit it (the request serializes to {}). The HumanEval id is kept only in our
    # own results record and the posted problem text for traceability.
    resp = _with_retry(
        client.agent_api_chats.create_agent_chat,
        chat=ChatRoomRequest(),
    )
    room_id = resp.data.id
    for role in ROLES:
        _with_retry(
            client.agent_api_participants.add_agent_chat_participant,
            room_id,
            participant=ParticipantRequest(participant_id=agent_ids[role], role="member"),
        )
    logging.info("[%s] room %s created, %d agents added", problem["task_id"], room_id, len(ROLES))
    return room_id


def post_problem(client: RestClient, room_id: str, problem: dict, spec_id: str) -> None:
    """Post the problem to the room, mentioning @Spec to start the chain."""
    content = (
        f"@Spec problem {problem['task_id']}: solve this so it passes the hidden tests.\n\n"
        f"{problem['prompt']}"
    )
    _with_retry(
        client.agent_api_messages.create_agent_chat_message,
        room_id,
        message=ChatMessageRequest(
            content=content,
            mentions=[ChatMessageRequestMentionsItem(id=spec_id, name="Spec")],
        ),
    )
    emit("message_posted", role="conductor", room_id=room_id, task_id=problem["task_id"],
         preview=content, mentions=["Spec"])
    logging.info("[%s] posted problem, mentioned @Spec", problem["task_id"])


def harvest(client: RestClient, room_id: str, repairer_id: str, conductor_id: str, deadline: float, poll: float, task_id: str | None = None, should_stop=None):
    """Poll the room conversation until the Repairer's terminal message or the deadline.

    Reads the whole room via the agent context endpoint (not the conductor's inbox), so every new
    message is logged as a who-spoke-when trace and the terminal is detected even when nothing is
    routed to the conductor's inbox. A Repairer message is terminal only when it also mentions the
    Conductor, so a repair-round message is never harvested by mistake. Each newly observed message
    emits a message_posted event (this is how the agents' posts reach the event stream). Returns
    ('FINAL_SOLUTION', code) | ('NO_SOLUTION', '') | ('TIMEOUT', '').
    """
    seen: set[str] = set()
    start = time.monotonic()
    last_beat = start
    while time.monotonic() < deadline:
        if should_stop and should_stop():
            logging.info("    (harvest aborted on stop)")
            return "TIMEOUT", ""
        resp = _with_retry(client.agent_api_context.get_agent_chat_context, room_id, page_size=100)
        saw_new = False
        for msg in sorted(resp.data, key=_msg_ts):
            if msg.id in seen:
                continue
            seen.add(msg.id)
            saw_new = True
            who = msg.sender_name or msg.sender_id
            snippet = " ".join(msg.content.split())[:140]
            logging.info("    %s (%s): %s", who, msg.sender_type, snippet)
            # The agents emit their own message_posted events now (the inbox-scoped conductor only sees
            # messages that mention it, so it cannot observe the Spec->Coder->Tester handoffs at all).
            from_repairer = msg.sender_id == repairer_id or (msg.sender_name or "").lower() == "repairer"
            if from_repairer:
                status, solution = classify(msg.content)
                if status and not _mentions_conductor(msg, conductor_id):
                    logging.info("    (ignoring Repairer %s without @Conductor mention)", status)
                    continue
                if status:
                    emit("terminal_emitted", role="conductor", room_id=room_id, task_id=task_id,
                         kind=status, mentions_conductor=True)
                    return status, solution
        now = time.monotonic()
        if saw_new:
            last_beat = now
            # Refresh the transcript so the reasoning panel fills in as agents speak, not only at the
            # end. Solution is empty until a terminal is found; the final write adds it.
            try:
                _save_transcript(os.environ.get("QUARTET_RUN_ID", ""), task_id or "", room_id, "", "", resp.data)
            except Exception:  # noqa: BLE001 - never let transcript I/O interrupt harvesting
                pass
        elif now - last_beat >= 30:
            logging.info("    ...waiting for agents (%ds elapsed, %d message(s) seen)", int(now - start), len(seen))
            last_beat = now
        time.sleep(poll)
    return "TIMEOUT", ""


def drive_room(client: RestClient, problem: dict, room_id: str, agent_ids: dict, conductor_id: str, timeout: float, poll: float, trace: bool = False, should_stop=None) -> dict:
    """Post the problem into an already-open room, harvest the terminal, score, write the transcript.

    Split out from run_problem so the demo launcher can pre-create the room and start the agents into
    it (room-first ordering) before driving it, which makes the four agents join deterministically
    instead of racing the RoomAddedEvent push.
    """
    start = time.monotonic()
    task_id = problem["task_id"]
    emit("run_started", role="conductor", room_id=room_id, task_id=task_id, models=models_map())
    post_problem(client, room_id, problem, agent_ids["spec"])
    status, solution = harvest(client, room_id, agent_ids["repairer"], conductor_id, time.monotonic() + timeout, poll, task_id, should_stop=should_stop)

    record = {
        "task_id": task_id,
        "room_id": room_id,
        "status": status,
        "passed": False,
        "timed_out": status == "TIMEOUT",
        "error": None,
        "solution": solution,
    }
    if status == "FINAL_SOLUTION":
        result = run_tests(solution, problem["test"], problem["entry_point"])
        record["passed"] = result["passed"]
        record["timed_out"] = result["timed_out"]
        record["error"] = result["error"].splitlines()[0][:200] if result["error"] else None
    elif status == "NO_SOLUTION":
        record["error"] = "agents emitted NO_SOLUTION"
    else:  # TIMEOUT
        record["error"] = f"no terminal message within {timeout:.0f}s"

    # Write the reasoning transcript BEFORE the scored event. scored ends the live SSE and the UI
    # fetches /api/transcript in response; writing first guarantees the file is on disk by then.
    try:
        write_transcript_json(client, room_id, task_id, problem, solution)
    except Exception as e:  # noqa: BLE001 - a transcript failure must not sink the run
        logging.warning("[%s] reasoning transcript failed: %s", task_id, e)
    emit("scored", role="conductor", room_id=room_id, task_id=task_id, passed=record["passed"], status=status)
    if trace:
        try:
            write_transcript(client, room_id, task_id)
        except Exception as e:  # noqa: BLE001 - a transcript failure must not sink the run
            logging.warning("[%s] transcript failed: %s", task_id, e)

    logging.info(
        "[%s] %s passed=%s (%.1fs)",
        task_id, status, record["passed"], time.monotonic() - start,
    )
    return record


def run_problem(client: RestClient, problem: dict, agent_ids: dict, conductor_id: str, timeout: float, poll: float, settle: float, trace: bool = False) -> dict:
    """Open a room, wait for the agents to join, then drive it (CLI / benchmark path)."""
    task_id = problem["task_id"]
    room_id = open_room(client, problem, agent_ids)
    # Let the just-added agents receive the room-added event and subscribe before we post, so the
    # first message is not pushed before Spec is listening. A missed push still self-heals via the
    # agents' idle resync, but settling here avoids the wait in the common case.
    if settle > 0:
        logging.info("[%s] waiting %.0fs for agents to join the room...", task_id, settle)
        time.sleep(settle)
    return drive_room(client, problem, room_id, agent_ids, conductor_id, timeout, poll, trace)


def _ensure_run_env() -> str:
    """Ensure QUARTET_RUN_ID / QUARTET_EVENTS_PATH are set so the conductor's events are recorded.

    Under the self-test runner these are already exported (shared with the agents) and left as-is;
    standalone, the conductor mints its own run so it still logs its own side of the stream.
    """
    if not os.environ.get("QUARTET_EVENTS_PATH"):
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]
        os.environ["QUARTET_RUN_ID"] = run_id
        os.environ["QUARTET_EVENTS_PATH"] = f"results/events/{run_id}.jsonl"
    Path(os.environ["QUARTET_EVENTS_PATH"]).parent.mkdir(parents=True, exist_ok=True)
    logging.info("events -> %s", os.environ["QUARTET_EVENTS_PATH"])
    return os.environ["QUARTET_EVENTS_PATH"]


def run_benchmark(problems: list[dict], timeout: float, poll: float, settle: float, out_path: str, trace: bool = False) -> dict:
    """Run the Quartet over the given problems through Band and save the results JSON."""
    _ensure_run_env()
    agent_ids = {role: get_agent(role)["agent_id"] for role in ROLES}
    conductor_id = get_agent("conductor")["agent_id"]
    client = make_client()

    results = []
    for problem in problems:
        try:
            results.append(run_problem(client, problem, agent_ids, conductor_id, timeout, poll, settle, trace))
        except Exception as e:  # noqa: BLE001 - one bad room must not sink the benchmark
            logging.error("[%s] conductor error: %s", problem["task_id"], e)
            results.append({
                "task_id": problem["task_id"], "room_id": None, "status": "ERROR",
                "passed": False, "timed_out": False, "error": str(e)[:200], "solution": "",
            })

    pass_count = sum(1 for r in results if r["passed"])
    total = len(results)
    out = {
        "config": "quartet_local",
        "provider": os.environ.get("LLM_PROVIDER", "local"),
        "timeout": timeout,
        "pass_count": pass_count,
        "total": total,
        "pass_rate": pass_count / total if total else 0.0,
        "results": results,
    }
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))
    logging.info(
        "quartet_local: %d/%d pass@1=%.1f%% -> %s",
        pass_count, total, 100 * out["pass_rate"], path,
    )
    return out


# Self-contained problem for the offline --selftest path (no dataset, no Band, no LLM).
_SELFTEST_PROBLEM = {
    "task_id": "selftest/add",
    "prompt": 'def add(a, b):\n    """Return the sum of a and b."""\n',
    "entry_point": "add",
    "test": "def check(candidate):\n    assert candidate(2, 3) == 5\n    assert candidate(-1, 1) == 0\n",
}


def _selftest() -> bool:
    """Exercise classify + held-out scoring on canned messages. No network."""
    prompt = _SELFTEST_PROBLEM["prompt"]
    good = prompt + "    return a + b\n"
    bad = prompt + "    return a - b\n"
    cases = [
        ("final+correct block", f"@Conductor\nFINAL_SOLUTION\n```python\n{good}\n```", "FINAL_SOLUTION", True),
        ("final+wrong block", f"@Conductor\nFINAL_SOLUTION\n```python\n{bad}\n```", "FINAL_SOLUTION", False),
        ("prose, no block", "I think the final solution is done; FINAL_SOLUTION-ish but no block.", None, None),
        ("line-start NO_SOLUTION", "@Conductor\nNO_SOLUTION", "NO_SOLUTION", None),
        ("lowercase mid-line", "we hit no_solution then chased final_solution all day", None, None),
    ]
    ok = True
    for name, text, want_status, want_pass in cases:
        status, solution = classify(text)
        good_case = status == want_status
        extra = ""
        if status == "FINAL_SOLUTION" and want_pass is not None:
            res = run_tests(solution, _SELFTEST_PROBLEM["test"], _SELFTEST_PROBLEM["entry_point"])
            good_case = good_case and res["passed"] == want_pass
            extra = f" scored_passed={res['passed']}"
        print(f"{'OK  ' if good_case else 'FAIL'} {name}: status={status} (want {want_status}){extra}")
        ok = ok and good_case

    # #11: a terminal is harvested only when it also mentions the Conductor.
    cid = "cond-123"

    class _M:  # minimal ChatMessage stand-in for the mention gate
        def __init__(self, content):
            self.content = content
            self.metadata = None

    mention_cases = [
        ("literal @Conductor", _M("@Conductor\nFINAL_SOLUTION\n```python\nx\n```"), True),
        ("normalized token", _M(f"@[[{cid}]] FINAL_SOLUTION"), True),
        ("no mention (repair-round bleed)", _M("FINAL_SOLUTION\n```python\nx\n```"), False),
    ]
    for name, m, want in mention_cases:
        got = _mentions_conductor(m, cid)
        good_case = got == want
        print(f"{'OK  ' if good_case else 'FAIL'} mention/{name}: {got} (want {want})")
        ok = ok and good_case
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description="Drive the Quartet over HumanEval through Band (Agent API).")
    ap.add_argument("--n", type=int, default=3, help="number of problems (default 3, dry run)")
    ap.add_argument("--task", help="run a single HumanEval task by id (e.g. HumanEval/0); overrides --n")
    ap.add_argument("--timeout", type=float, default=180.0, help="per-problem timeout in seconds")
    ap.add_argument("--poll", type=float, default=2.0, help="harvest poll interval in seconds")
    ap.add_argument("--settle", type=float, default=2.0, help="delay after adding agents before posting")
    ap.add_argument("--trace", action="store_true", help="write the full room transcript per problem")
    ap.add_argument("--out", default=_DEFAULT_OUT, help=f"results path (default {_DEFAULT_OUT})")
    ap.add_argument("--selftest", action="store_true", help="offline parse+score check, no Band")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Keep the room trace readable: silence per-request HTTP and dataset-download chatter.
    for noisy in ("httpx", "httpcore", "datasets", "huggingface_hub", "urllib3", "fsspec"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    if args.selftest:
        ok = _selftest()
        print("\nselftest:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)

    from bench.dataset import get_problem, get_problems

    problems = [get_problem(args.task)] if args.task else get_problems(args.n)
    run_benchmark(problems, args.timeout, args.poll, args.settle, args.out, args.trace)


if __name__ == "__main__":
    main()
