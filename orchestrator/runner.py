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

import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

from bench.events import read_events
from orchestrator import run_config
from orchestrator.config import LOCAL_AGENTS_URL, LOCAL_LARGE_URL, aimlapi_key, get_agent

ROOT = Path(__file__).resolve().parent.parent
EVENTS_DIR = ROOT / "results" / "events"
LOGS_DIR = ROOT / "results" / "logs"
ROLES = ["spec", "coder", "tester", "repairer"]

_CONNECT_TIMEOUT = 60.0   # seconds to wait for all four agents to connect to Band
_SETTLE_AFTER_CONNECT = 3.0  # let startup room subscription settle before posting
# Per-problem harvest timeout. Generous because a local CPU/MoE model runs the whole loop (Spec ->
# Coder -> Tester -> Repairer plus a repair round), several seconds per generation plus Band round
# trips. A hosted provider finishes far inside this.
_DRIVE_TIMEOUT = 360.0
_DRIVE_POLL = 2.0


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
        """Begin a live run for task_id. Stops any in-flight run first. Returns the new run state."""
        self.stop()
        run_id = _mint_run_id()
        # Fail fast on an unrunnable config (e.g. agents set to aimlapi with no key) instead of
        # spawning four processes that die on the first model call and look like a silent stall.
        fatal = _fatal_config_error()
        if fatal:
            with self._lock:
                self.state = {
                    "status": "error", "run_id": run_id, "task_id": task_id,
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
                "started_at": datetime.now(timezone.utc).isoformat(),
                "ended_at": None,
                "result": None,
                "warnings": _preflight(),
                "error": None,
            }
            self._thread = threading.Thread(target=self._run, args=(run_id, task_id), daemon=True)
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

    def _run(self, run_id: str, task_id: str) -> None:
        events_path = EVENTS_DIR / f"{run_id}.jsonl"
        EVENTS_DIR.mkdir(parents=True, exist_ok=True)
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        cfg = run_config.load()
        child_base = {
            **os.environ,
            "QUARTET_RUN_ID": run_id,
            "QUARTET_EVENTS_PATH": str(events_path),
        }
        try:
            # Lazy import so a syntax error here cannot break the read-only server import path.
            from orchestrator import conductor
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


def _fatal_config_error() -> str | None:
    """Return a clear message when the run cannot possibly produce agent inference, so start() can
    refuse instead of spawning agents that die immediately. The unambiguous cases are fatal: agents
    set to aimlapi with no key at all, or with a key that is actually a band_ chat-room key (which
    aimlapi rejects). A local server being down is a warning (it may come up during the connect
    window), handled by _preflight."""
    cfg = run_config.load()
    agent_providers = {a["provider"] for a in cfg["agents"].values()}
    if "aimlapi" in agent_providers:
        key = _aiml_key()
        if not key:
            return (
                "agents are set to the aimlapi provider but no aimlapi key is set. Add it to "
                "agent_config.yaml as `aiml_api_key: <key>` (or AIML_API_KEY in .env), or switch the "
                "agents to the local provider in Models. The band_ keys in agent_config.yaml "
                "authenticate the Band chat room, not the model inference - aimlapi needs its own key."
            )
        if key.startswith("band_"):
            return (
                "the aimlapi key looks like a Band chat-room key (it starts with 'band_'). aimlapi "
                "will reject it. Put your aimlapi inference key (from aimlapi.com) in agent_config.yaml "
                "as `aiml_api_key: <key>`, or switch the agents to the local provider in Models."
            )
    return None


def _preflight() -> list[str]:
    """Best-effort check that the selected inference endpoints are reachable. Warnings only; the run
    still starts so a judge sees the agents connect and any failure surfaces in the stream. Two local
    servers in the default topology: the agents on :8081, the large competitor on :8080."""
    warnings: list[str] = []
    cfg = run_config.load()
    agent_providers = {a["provider"] for a in cfg["agents"].values()}
    if "local" in agent_providers and not _local_up(LOCAL_AGENTS_URL):
        warnings.append(f"agents model server not reachable at {LOCAL_AGENTS_URL} (start it for live runs)")
    if cfg["large"]["provider"] == "local" and not _local_up(LOCAL_LARGE_URL):
        warnings.append(f"large model server not reachable at {LOCAL_LARGE_URL} (start it for live runs)")
    if ("aimlapi" in agent_providers or cfg["large"]["provider"] == "aimlapi") and not _aiml_key():
        warnings.append("no aimlapi key found (set aiml_api_key in agent_config.yaml or AIML_API_KEY in .env)")
    return warnings


def _local_up(url: str) -> bool:
    try:
        httpx.get(url.rstrip("/") + "/models", timeout=2.0)
        return True
    except httpx.HTTPError:
        return False
