"""Run manager: starts a real, live Quartet run from the demo server and races a large model.

This is the control plane behind POST /api/run. It owns the process lifecycle so the read-only data
plane (the SSE bridge) stays simple. One run at a time.

Room-first ordering is the deterministic fix for the hop-1 stall: the four agents used to miss the
RoomAddedEvent push for a freshly opened room and, with no recovery path, stayed deaf to it. Here we
create the room and add the agents BEFORE starting them, then start each agent with
QUARTET_AUTO_SUBSCRIBE=1 so it subscribes to the room it already belongs to at startup. Fresh agents
per run also bind the dashboard's model selection (the model is fixed when the process starts).

Sequence per run:
  1. load model selection, mint run_id + events path
  2. create the room and add the four agents (conductor's REST client)
  3. spawn the four agent processes into that room (auto-subscribe), wait for agent_connected x4
  4. spawn the large competitor one-shot on the same task (its own provider/model)
  5. drive the room (post @Spec, harvest, score, write the reasoning transcript)
  6. tear the processes down

No API keys are handled here beyond what the child processes load themselves from .env /
agent_config.yaml; nothing secret is returned to the caller.
"""

from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

from bench import pricing
from bench.events import read_events
from orchestrator import keystore, run_config, stacks
from orchestrator.config import (
    AIMLAPI_BASE_URL,
    GEMINI_BASE_URL,
    GROQ_BASE_URL,
    LOCAL_AGENTS_URL,
    LOCAL_LARGE_URL,
    OPENROUTER_BASE_URL,
    aimlapi_key,
    get_agent,
    provider_secret,
)

# Providers that need a key/base resolved server-side before a run can produce inference.
_KEYED_PROVIDERS = ("groq", "aimlapi", "gemini", "openrouter", "openai_compatible")
# Keyed providers with a fixed base whose secret injects as one env var (config reads these first).
_KEY_ENV_VARS = {
    "groq": "GROQ_API_KEY",
    "aimlapi": "AIML_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _provider_key_env() -> dict:
    """Provider secrets from the in-memory keystore as child-process env vars. Spawned agents have no
    keystore of their own (a fresh process), so the keys reach them only through this env. Never logged.
    Maps to the names config.provider_secret reads first (GROQ_API_KEY / AIML_API_KEY / GEMINI_API_KEY /
    OPENROUTER_API_KEY / OPENAI_COMPAT_*)."""
    keys = keystore.all_keys()
    env: dict[str, str] = {}
    for provider, var in _KEY_ENV_VARS.items():
        api_key = (keys.get(provider) or {}).get("api_key")
        if api_key:
            env[var] = api_key
    oc = keys.get("openai_compatible") or {}
    if oc.get("base_url"):
        env["OPENAI_COMPAT_BASE_URL"] = oc["base_url"]
    if oc.get("api_key"):
        env["OPENAI_COMPAT_API_KEY"] = oc["api_key"]
    return env

ROOT = Path(__file__).resolve().parent.parent
EVENTS_DIR = ROOT / "results" / "events"
LOGS_DIR = ROOT / "results" / "logs"
LAB_RUNS_DIR = ROOT / "results" / "lab" / "runs"  # one persisted StackResult per stack, newest wins
ROLES = ["spec", "coder", "tester", "repairer"]

_CONNECT_TIMEOUT = 60.0   # seconds to wait for all four agents to connect to Band
_SETTLE_AFTER_CONNECT = 3.0  # let startup room subscription settle before posting
# Per-problem harvest timeout. Generous because a local CPU/MoE model runs the whole loop (Spec ->
# Coder -> Tester -> Repairer plus a repair round), several seconds per generation plus Band round
# trips. A hosted provider finishes far inside this.
_DRIVE_TIMEOUT = 360.0
_DRIVE_POLL = 2.0

# Lab: long-lived agents run the subset, each problem in its own room. Per-problem timeout is tighter
# than the single-race one (a hosted provider answers fast) but still room for one repair round.
_LAB_PROBLEM_TIMEOUT = 240.0
_LAB_SETTLE = 3.0   # delay after opening each per-problem room before posting (RoomAddedEvent push)
_LAB_MAX_N = 20

# Estimate-only single-large reference (no model call): how a lone large model would do/cost on the
# same subset. Pass@1 comes from a prior baselines.json single_large run when present; tokens from that
# run's per-problem average, else this heuristic. Always labeled an estimate in the result.
_REF_TOKENS_PER_PROBLEM = 1100   # a large model reads one prompt and writes one solution
_REF_PROMPT_FRACTION = 0.6       # assumed input/output split when only a token total is known

_STACK_FILE_OK = re.compile(r"[^A-Za-z0-9._-]+")


def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def _safe_stack_file(name: str) -> Path:
    slug = _STACK_FILE_OK.sub("-", (name or "").strip()).strip("-.") or "stack"
    return LAB_RUNS_DIR / f"{slug}.json"


def _reference_estimate(cfg: dict, n: int, table: dict) -> dict:
    """A labeled cost/Pass@1 estimate for the lone large model over the same subset (no run)."""
    model = cfg["large"]["model"]
    sl = (_read_json(ROOT / "results" / "baselines.json") or {}).get("single_large") or {}
    pass_rate = None
    basis = "heuristic"
    tpp = float(_REF_TOKENS_PER_PROBLEM)
    if sl.get("total"):
        if isinstance(sl.get("pass_rate"), (int, float)):
            pass_rate = float(sl["pass_rate"])
        elif sl.get("pass_count") is not None:
            pass_rate = sl["pass_count"] / sl["total"]
        if sl.get("total_tokens"):
            tpp = sl["total_tokens"] / sl["total"]
            basis = "baselines.json"
    total_tokens = int(round(tpp * n))
    prompt = int(round(total_tokens * _REF_PROMPT_FRACTION))
    completion = total_tokens - prompt
    cost = pricing.cost_usd(model, prompt, completion, table)
    pass_count = int(round(pass_rate * n)) if pass_rate is not None else None
    cps = round(cost / pass_count, 6) if pass_count else None
    return {
        "source": "estimate", "basis": basis, "model": model, "provider": cfg["large"]["provider"],
        "pass_rate": pass_rate, "pass_count": pass_count, "n_total": n,
        "total_tokens": total_tokens, "cost_usd": round(cost, 6), "cost_per_solved": cps,
    }


def _aggregate_lab(stack_name: str, run_id: str, cfg: dict, problems: list, per_problem: list,
                   events: list, wall_s: float) -> dict:
    """Build the persisted StackResult from per-problem scores + the run's llm_call token telemetry."""
    table = pricing.load_pricing()
    agg = pricing.cost_from_events(events, table)  # a lab has no race lane, so all llm_call are agents
    n = len(per_problem)
    pass_count = sum(1 for r in per_problem if r["passed"])
    total = agg["total"]
    latencies = [r["latency_ms"] for r in per_problem if r.get("latency_ms")]
    return {
        "stack": stack_name,
        "run_id": run_id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "source": "real",
        "n_total": n,
        "subset": [p["task_id"] for p in problems],
        "models": {**{r: cfg["agents"][r] for r in ROLES}, "large": cfg["large"]},
        "pass_count": pass_count,
        "pass_rate": pass_count / n if n else 0.0,
        "tokens": {"prompt": total["prompt"], "completion": total["completion"], "total": total["total"]},
        "cost_usd": round(total["cost_usd"], 6),
        "cost_per_solved": round(total["cost_usd"] / pass_count, 6) if pass_count else 0.0,
        "by_role": agg["by_role"],
        "latency": {"total_ms": int(wall_s * 1000), "avg_ms": int(sum(latencies) / len(latencies)) if latencies else 0},
        "per_problem": per_problem,
        "reference": _reference_estimate(cfg, n, table),
    }


def _persist_lab_result(result: dict) -> None:
    LAB_RUNS_DIR.mkdir(parents=True, exist_ok=True)
    _safe_stack_file(result["stack"]).write_text(json.dumps(result, indent=2))


def list_lab_results() -> list[dict]:
    """Every persisted StackResult (results/lab/runs/*.json), newest first. Holds no keys."""
    out: list[dict] = []
    if not LAB_RUNS_DIR.exists():
        return out
    for p in sorted(LAB_RUNS_DIR.glob("*.json")):
        data = _read_json(p)
        if isinstance(data, dict):
            out.append(data)
    out.sort(key=lambda r: r.get("ts") or "", reverse=True)
    return out


def _mint_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]


class RunManager:
    """Owns the currently active live run and its child processes. Thread-safe for the few methods
    the HTTP handler touches; the run itself executes on a daemon worker thread."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._procs: list[subprocess.Popen] = []
        self._agents: list[dict] = []  # [{role, pid}]
        self._thread: threading.Thread | None = None
        self.state: dict = {"status": "idle", "run_id": None, "task_id": None}

    # ---- public API (called from the HTTP handler) ----

    def status(self) -> dict:
        with self._lock:
            agents = [{"role": a["role"], "pid": a["pid"], "alive": _alive(a["pid"])} for a in self._agents]
            return {**self.state, "agents": agents, "active": self.state.get("status") in ("starting", "running")}

    def start(self, task_id: str) -> dict:
        """Begin a live HumanEval race run for task_id. Stops any in-flight run first."""
        return self._start(task_id, build=None)

    def start_build(self, description: str, project_type: str = "auto", run_id: str | None = None) -> dict:
        """Begin a live BUILD run: the quartet builds a small project from a plain-language request.
        No large-model race; the Coder defaults to Groq gpt-oss-120b (run_config.apply_build_defaults)."""
        return self._start("build", build={"description": description, "project_type": project_type or "auto"}, run_id=run_id)

    def start_lab(self, stack_name: str, n: int = 5) -> dict:
        """Begin a Stack Lab run: the quartet (this stack's models) over the n hardest HumanEval problems,
        scored against the held-out tests, aggregating real token cost. No large-model race; the single
        large reference is an estimate. Loading the stack makes it the active config. Persists
        results/lab/runs/<stack>.json on completion. Stops any in-flight run first."""
        self.stop()
        run_id = _mint_run_id()
        now = datetime.now(timezone.utc).isoformat()
        try:
            cfg = stacks.activate_stack(stack_name)  # writes run_config.json: whole system stays consistent
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as e:
            with self._lock:
                self.state = {"status": "error", "run_id": run_id, "task_id": "lab", "mode": "lab",
                              "stack": stack_name, "started_at": now, "ended_at": now, "result": None,
                              "warnings": [], "error": f"could not load stack: {str(e)[:120]}", "lab": None}
            return self.status()
        n = max(1, min(int(n or 5), _LAB_MAX_N))
        fatal = _fatal_config_error(cfg)
        if fatal:
            with self._lock:
                self.state = {"status": "error", "run_id": run_id, "task_id": "lab", "mode": "lab",
                              "stack": stack_name, "started_at": now, "ended_at": now, "result": None,
                              "warnings": [], "error": fatal, "lab": None}
            return self.status()
        with self._lock:
            self.state = {
                "status": "starting", "run_id": run_id, "task_id": "lab", "mode": "lab", "stack": stack_name,
                "started_at": now, "ended_at": None, "result": None, "error": None,
                "warnings": _preflight(cfg),
                "lab": {"done": 0, "total": n, "passed": 0, "problems": []},
            }
            self._thread = threading.Thread(target=self._run_lab, args=(run_id, stack_name, n, cfg), daemon=True)
            self._thread.start()
        return self.status()

    def _start(self, task_id: str, build: dict | None, run_id: str | None = None) -> dict:
        """Shared launcher for race and build runs."""
        self.stop()
        run_id = run_id or _mint_run_id()
        # The config the run will actually use (build overlays the Groq coder default).
        cfg = run_config.apply_build_defaults(run_config.load()) if build else run_config.load()
        # Fail fast on an unrunnable config (e.g. agents on a keyed provider with no key) instead of
        # spawning four processes that die on the first model call and look like a silent stall.
        fatal = _fatal_config_error(cfg)
        if fatal:
            with self._lock:
                self.state = {
                    "status": "error", "run_id": run_id, "task_id": task_id, "mode": "build" if build else "race",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                    "result": None, "warnings": [], "error": fatal,
                }
            return self.status()
        with self._lock:
            self.state = {
                "status": "starting",
                "run_id": run_id,
                "task_id": task_id,
                "mode": "build" if build else "race",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "ended_at": None,
                "result": None,
                "warnings": _preflight(cfg),
                "error": None,
            }
            self._thread = threading.Thread(target=self._run, args=(run_id, task_id, build), daemon=True)
            self._thread.start()
        return self.status()

    def stop(self) -> None:
        """Terminate the agent + baseline processes of the current run, if any."""
        with self._lock:
            procs, self._procs = self._procs, []
            self._agents = []
            if self.state.get("status") in ("starting", "running"):
                self.state = {**self.state, "status": "stopped", "ended_at": datetime.now(timezone.utc).isoformat()}
        for p in procs:
            _terminate(p)

    # ---- worker ----

    def _run(self, run_id: str, task_id: str, build: dict | None = None) -> None:
        events_path = EVENTS_DIR / f"{run_id}.jsonl"
        EVENTS_DIR.mkdir(parents=True, exist_ok=True)
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        cfg = run_config.apply_build_defaults(run_config.load()) if build else run_config.load()
        child_base = {
            **os.environ,
            "QUARTET_RUN_ID": run_id,
            "QUARTET_EVENTS_PATH": str(events_path),
            # Inject the in-memory provider keys so each spawned agent / baseline resolves its cloud
            # model. The keys are never written to disk; they exist only in this process and the
            # children's env. config.provider_secret reads these env names first.
            **_provider_key_env(),
        }
        if build:
            child_base["QUARTET_MODE"] = "build"
        try:
            # Lazy import so a syntax error here cannot break the read-only server import path.
            from orchestrator import conductor

            if build:
                # Build mode: a synthetic problem carrying the plain-language request (no dataset).
                problem = {
                    "task_id": f"build-{run_id}",
                    "run_id": run_id,  # the project dir is keyed on this so the UI (which polls the
                    "prompt": build["description"],  # status run_id) finds the files build_project writes
                    "mode": "build",
                    "project_type": build.get("project_type", "auto"),
                    "entry_point": None,
                    "test": None,
                }
            else:
                from bench.dataset import get_problem
                problem = get_problem(task_id)
            client = conductor.make_client()
            agent_ids = {role: get_agent(role)["agent_id"] for role in ROLES}
            conductor_id = get_agent("conductor")["agent_id"]

            # 2. room-first: create room + add the four agents before they start.
            room_id = conductor.open_room(client, problem, agent_ids)

            # 3. start fresh agents into the room (auto-subscribe at startup, no push race). Pin each
            # to this room so it ignores any stale @mention left in older rooms it still belongs to.
            for role in ROLES:
                env = {
                    **child_base,
                    "QUARTET_AUTO_SUBSCRIBE": "1",
                    "QUARTET_ROOM_ID": room_id,
                    # The four agents run the small coder model on the agents server (:8081); only the
                    # large competitor uses the Qwen3.6 server (:8080), so the race is truly parallel.
                    "LOCAL_BASE_URL": LOCAL_AGENTS_URL,
                    **run_config.role_env(role, cfg),
                }
                self._spawn(["-m", f"agents.{role}"], env, run_id, role)
            self._set_status("running")

            if not self._wait_connected(events_path, _CONNECT_TIMEOUT):
                if self._stopped():
                    return
                self._warn("agents did not all connect to Band within the timeout")
            time.sleep(_SETTLE_AFTER_CONNECT)
            if self._stopped():
                return

            # 4. race lane: the lone large model one-shots the same task, scored on the hidden test.
            # Build mode is a build, not a competition, so there is no large-model race.
            if not build:
                large = cfg["large"]
                self._spawn(
                    ["-m", "bench.baselines", "--live", "--task", task_id, "--model", large["model"], "--role", "single_large"],
                    {**child_base, "LLM_PROVIDER": large["provider"], "LOCAL_BASE_URL": LOCAL_LARGE_URL},
                    run_id, "single_large",
                )

            # 5. drive the room to a terminal and score it (abortable via stop()).
            record = conductor.drive_room(
                client, problem, room_id, agent_ids, conductor_id,
                _DRIVE_TIMEOUT, _DRIVE_POLL, should_stop=self._stopped,
            )
            with self._lock:
                if self.state.get("status") != "stopped":
                    self.state = {**self.state, "status": "done", "result": record,
                                  "ended_at": datetime.now(timezone.utc).isoformat()}
        except Exception as e:  # noqa: BLE001 - report the failure, never crash the server thread
            with self._lock:
                self.state = {**self.state, "status": "error", "error": str(e)[:300],
                              "ended_at": datetime.now(timezone.utc).isoformat()}
        finally:
            # 6. tear down child processes; leave the events + transcript on disk for replay.
            with self._lock:
                procs, self._procs = self._procs, []
            for p in procs:
                _terminate(p)

    def _run_lab(self, run_id: str, stack_name: str, n: int, cfg: dict) -> None:
        """Lab worker: long-lived agents run the n-problem subset (each in its own room), then aggregate
        real token cost and persist the StackResult. No large-model race; the reference is an estimate."""
        events_path = EVENTS_DIR / f"{run_id}.jsonl"
        EVENTS_DIR.mkdir(parents=True, exist_ok=True)
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        child_base = {**os.environ, "QUARTET_RUN_ID": run_id, "QUARTET_EVENTS_PATH": str(events_path), **_provider_key_env()}
        child_base.pop("QUARTET_MODE", None)  # never inherit build mode into a lab run
        started = time.monotonic()
        try:
            from orchestrator import conductor
            from bench.dataset import get_problems

            problems = get_problems(n)
            client = conductor.make_client()
            agent_ids = {role: get_agent(role)["agent_id"] for role in ROLES}
            conductor_id = get_agent("conductor")["agent_id"]

            # Long-lived agents for the whole subset (one set, not respawned per problem). They join each
            # per-problem room via the RoomAddedEvent push, recovered by idle_resync if a push is missed.
            for role in ROLES:
                env = {**child_base, "LOCAL_BASE_URL": LOCAL_AGENTS_URL, **run_config.role_env(role, cfg)}
                self._spawn(["-m", f"agents.{role}"], env, run_id, role)
            self._set_status("running")

            if not self._wait_connected(events_path, _CONNECT_TIMEOUT):
                if self._stopped():
                    return
                self._warn("agents did not all connect to Band within the timeout")
            time.sleep(_SETTLE_AFTER_CONNECT)
            if self._stopped():
                return

            per_problem: list[dict] = []
            for i, problem in enumerate(problems):
                if self._stopped():
                    break
                t0 = time.monotonic()
                try:
                    record = conductor.run_problem(
                        client, problem, agent_ids, conductor_id,
                        _LAB_PROBLEM_TIMEOUT, _DRIVE_POLL, _LAB_SETTLE, should_stop=self._stopped,
                    )
                except Exception as e:  # noqa: BLE001 - one bad room must not sink the subset
                    record = {"task_id": problem["task_id"], "status": "ERROR", "passed": False, "error": str(e)[:200]}
                per_problem.append({
                    "task_id": problem["task_id"], "passed": bool(record.get("passed")),
                    "status": record.get("status"), "latency_ms": int((time.monotonic() - t0) * 1000),
                    "error": record.get("error"),
                })
                with self._lock:
                    lab = dict(self.state.get("lab") or {"done": 0, "total": n, "passed": 0, "problems": []})
                    lab.update({"done": i + 1, "passed": sum(1 for r in per_problem if r["passed"]), "problems": per_problem})
                    self.state = {**self.state, "lab": lab}

            # Tear agents down before aggregating (frees the model slots; events are already on disk).
            with self._lock:
                procs, self._procs, self._agents = self._procs, [], []
            for p in procs:
                _terminate(p)
            if self._stopped():
                return

            result = _aggregate_lab(stack_name, run_id, cfg, problems, per_problem,
                                    read_events(str(events_path)), time.monotonic() - started)
            _persist_lab_result(result)
            with self._lock:
                if self.state.get("status") != "stopped":
                    self.state = {**self.state, "status": "done", "result": result,
                                  "ended_at": datetime.now(timezone.utc).isoformat()}
        except Exception as e:  # noqa: BLE001 - report the failure, never crash the server thread
            with self._lock:
                self.state = {**self.state, "status": "error", "error": str(e)[:300],
                              "ended_at": datetime.now(timezone.utc).isoformat()}
        finally:
            with self._lock:
                procs, self._procs, self._agents = self._procs, [], []
            for p in procs:
                _terminate(p)

    # ---- helpers ----

    def _spawn(self, args: list[str], env: dict, run_id: str, label: str) -> None:
        log_path = LOGS_DIR / f"{run_id}-{label}.log"
        log = open(log_path, "w")  # noqa: SIM115 - handle closed when the process is reaped by the OS
        proc = subprocess.Popen(
            [sys.executable, *args],
            cwd=str(ROOT),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # own process group so _terminate can kill the whole tree
        )
        with self._lock:
            self._procs.append(proc)
            if label in ROLES:
                self._agents.append({"role": label, "pid": proc.pid})

    def _wait_connected(self, events_path: Path, timeout: float) -> bool:
        """Poll the events file until all four agents have emitted agent_connected (or timeout)."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.state.get("status") == "stopped":
                return False
            connected = {
                e.get("role")
                for e in read_events(str(events_path))
                if e.get("type") == "agent_connected" and e.get("role") in ROLES
            }
            if len(connected) >= len(ROLES):
                return True
            time.sleep(0.5)
        return False

    def _stopped(self) -> bool:
        return self.state.get("status") == "stopped"

    def _set_status(self, status: str) -> None:
        with self._lock:
            if self.state.get("status") not in ("stopped", "error", "done"):
                self.state = {**self.state, "status": status}

    def _warn(self, msg: str) -> None:
        with self._lock:
            self.state = {**self.state, "warnings": [*self.state.get("warnings", []), msg]}


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _terminate(proc: subprocess.Popen) -> None:
    """SIGTERM the process group, then SIGKILL if it lingers."""
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except (ProcessLookupError, OSError):
        return
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass


def _aiml_key() -> str | None:
    """The aimlapi inference key (env / .env / agent_config.yaml), or None."""
    return aimlapi_key()


def _missing_key_message(provider: str) -> str:
    """Why a keyed provider cannot run, with where to put the key."""
    if provider == "aimlapi":
        return (
            "agents/large use the aimlapi provider but no aimlapi key is set. Add it in the dashboard "
            "(Build your stack), or as `aiml_api_key: <key>` in agent_config.yaml / AIML_API_KEY in .env. "
            "The band_ keys authenticate the Band chat room, not model inference - aimlapi needs its own."
        )
    if provider in _KEY_ENV_VARS:
        return (
            f"agents/large use the {provider} provider but no {provider} key is set. Add it in the "
            f"dashboard (Build your stack), or set {_KEY_ENV_VARS[provider]} in .env."
        )
    return (
        "agents/large use the openai_compatible provider but no base_url is set. Add it in the dashboard "
        "(Build your stack), or set OPENAI_COMPAT_BASE_URL in .env."
    )


def _provider_unrunnable(provider: str) -> bool:
    """True when a keyed provider lacks the secret it needs to make any call at all."""
    secret = provider_secret(provider)
    if provider == "openai_compatible":
        return not secret.get("base_url")
    return not secret.get("api_key")


def _fatal_config_error(cfg: dict | None = None) -> str | None:
    """Return a clear message when the run cannot possibly produce agent inference, so start() can
    refuse instead of spawning agents that die immediately. Fatal cases: a keyed provider (groq,
    aimlapi, openai_compatible) selected with no key/base, or an aimlapi key that is actually a band_
    chat-room key (which aimlapi rejects). A local server being down is a warning (it may come up
    during the connect window), handled by _preflight."""
    cfg = cfg or run_config.load()
    used = {a["provider"] for a in cfg["agents"].values()} | {cfg["large"]["provider"]}
    for provider in _KEYED_PROVIDERS:
        if provider in used and _provider_unrunnable(provider):
            return _missing_key_message(provider)
    if "aimlapi" in used:
        key = _aiml_key()
        if key and key.startswith("band_"):
            return (
                "the aimlapi key looks like a Band chat-room key (it starts with 'band_'). aimlapi "
                "will reject it. Put your aimlapi inference key (from aimlapi.com) in the dashboard or "
                "agent_config.yaml as `aiml_api_key: <key>`, or switch to the local provider in Models."
            )
    return None


def _preflight(cfg: dict | None = None) -> list[str]:
    """Best-effort check that the selected inference endpoints are reachable. Warnings only; the run
    still starts so a judge sees the agents connect and any failure surfaces in the stream. Two local
    servers in the default topology: the agents on :8081, the large competitor on :8080."""
    warnings: list[str] = []
    cfg = cfg or run_config.load()
    agent_providers = {a["provider"] for a in cfg["agents"].values()}
    if "local" in agent_providers and not _local_up(LOCAL_AGENTS_URL):
        warnings.append(f"agents model server not reachable at {LOCAL_AGENTS_URL} (start it for live runs)")
    if cfg["large"]["provider"] == "local" and not _local_up(LOCAL_LARGE_URL):
        warnings.append(f"large model server not reachable at {LOCAL_LARGE_URL} (start it for live runs)")
    return warnings


def _local_up(url: str) -> bool:
    try:
        httpx.get(url.rstrip("/") + "/models", timeout=2.0)
        return True
    except httpx.HTTPError:
        return False


def _provider_base_key(provider: str) -> tuple[str | None, str | None]:
    """The OpenAI-compatible base URL and key for a provider's /models call (validation + dropdowns).
    local uses the agents server (no key). Returns (base_url, api_key); base_url None when unresolved."""
    if provider == "local":
        return LOCAL_AGENTS_URL, None
    if provider == "groq":
        return GROQ_BASE_URL, provider_secret("groq").get("api_key")
    if provider == "aimlapi":
        return AIMLAPI_BASE_URL, provider_secret("aimlapi").get("api_key")
    if provider == "gemini":
        return GEMINI_BASE_URL, provider_secret("gemini").get("api_key")
    if provider == "openrouter":
        return OPENROUTER_BASE_URL, provider_secret("openrouter").get("api_key")
    if provider == "openai_compatible":
        secret = provider_secret("openai_compatible")
        return secret.get("base_url"), secret.get("api_key")
    return None, None


def _models_url(base: str) -> str:
    return base.rstrip("/") + "/models"


def list_provider_models(provider: str) -> dict:
    """Fetch the provider's model id list via GET <base>/models (used to populate the dashboard
    dropdowns). Never returns or logs the key. Returns {models: [...]} or {models: [], note: ...}."""
    base, key = _provider_base_key(provider)
    if not base:
        return {"models": [], "note": "no base_url set for this provider"}
    # openrouter and openai_compatible expose /models without auth, so list them even before a key.
    if provider in _KEYED_PROVIDERS and not key and provider not in ("openai_compatible", "openrouter"):
        return {"models": [], "note": "no key set for this provider"}
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    try:
        resp = httpx.get(_models_url(base), headers=headers, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError) as e:
        return {"models": [], "note": f"could not list models: {str(e)[:120]}"}
    rows = data.get("data", data) if isinstance(data, dict) else data
    ids = sorted({r.get("id") for r in rows if isinstance(r, dict) and r.get("id")}) if isinstance(rows, list) else []
    return {"models": ids}


def validate_provider(provider: str) -> dict:
    """Reuse the preflight to check a provider is usable: local -> server reachable; a keyed provider
    -> its /models call returns 200 with the stored key. Returns {ok, detail}. Never echoes the key."""
    if provider == "local":
        up = _local_up(LOCAL_AGENTS_URL)
        return {"ok": up, "detail": f"agents server {'reachable' if up else 'not reachable'} at {LOCAL_AGENTS_URL}"}
    if provider not in _KEYED_PROVIDERS:
        return {"ok": False, "detail": f"unknown provider {provider!r}"}
    if _provider_unrunnable(provider):
        return {"ok": False, "detail": "no key/base_url set for this provider"}
    result = list_provider_models(provider)
    if result.get("models"):
        return {"ok": True, "detail": f"endpoint reachable, {len(result['models'])} models available"}
    return {"ok": False, "detail": result.get("note", "endpoint did not return any models")}
