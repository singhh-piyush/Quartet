"""Structured JSONL event stream shared by the agents and the conductor.

Every process appends one JSON object per line to the file named by the QUARTET_EVENTS_PATH env var,
tagged with the run id from QUARTET_RUN_ID. Telemetry is opt-in: when QUARTET_EVENTS_PATH is unset
emit() is a no-op, so manually started agents stay silent unless the runner (or the operator) exports
the vars before launch. Writes use a single os.write to an O_APPEND fd, which is atomic for our short
lines, so five processes can share one file without a lock.

Only previews go on the wire (<=200 chars); never api keys or full message bodies.

Event types and their extra fields:
  agent_connected
  message_received   sender, preview
  llm_call           model, prompt_tokens, completion_tokens, total_tokens, duration_ms
  message_posted     preview, mentions
  tool_call          tool, args_summary, result{passed,timed_out}, duration_ms
  terminal_emitted   kind  (FINAL_SOLUTION | NO_SOLUTION)
  scored             passed
"""

from __future__ import annotations

import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone

_PREVIEW_MAX = 200
_AGENT_ROLES = ("spec", "coder", "tester", "repairer")


def _preview(text: str | None) -> str:
    """Collapse whitespace and cap length so a preview never leaks a full body."""
    if not text:
        return ""
    s = " ".join(str(text).split())
    return s[:_PREVIEW_MAX]


def emit(event_type: str, *, role: str, room_id: str | None = None, task_id: str | None = None, **fields) -> None:
    """Append one event line. No-op unless QUARTET_EVENTS_PATH is set in the environment."""
    path = os.environ.get("QUARTET_EVENTS_PATH")
    if not path:
        return
    # Bound any free-text field so a full body can never reach the wire, whatever the caller passed.
    for k in ("preview", "sender", "args_summary"):
        if k in fields:
            fields[k] = _preview(fields[k])
    record = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "run_id": os.environ.get("QUARTET_RUN_ID", ""),
        "room_id": room_id,
        "task_id": task_id,
        "role": role,
        "type": event_type,
        **fields,
    }
    line = (json.dumps(record, ensure_ascii=False) + "\n").encode("utf-8")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, line)
    finally:
        os.close(fd)


def read_events(path: str) -> list[dict]:
    """Read a JSONL event file into a list, skipping any malformed line."""
    events: list[dict] = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        pass
    return events


def analyze(events: list[dict]) -> dict:
    """Aggregate per-role tallies and evaluate the five self-test checks.

    Returns {by_role, tool_calls, terminal, scored, checks} where checks maps each check name to a
    bool. by_role[role] = {connected, llm_calls, posts, tokens, received}.
    """
    by_role: dict[str, dict] = defaultdict(
        lambda: {"connected": False, "llm_calls": 0, "posts": 0, "tokens": 0, "received": 0}
    )
    tool_calls: list[dict] = []
    terminal: dict | None = None
    scored: dict | None = None

    for ev in events:
        role = ev.get("role") or "unknown"
        etype = ev.get("type")
        r = by_role[role]
        if etype == "agent_connected":
            r["connected"] = True
        elif etype == "llm_call":
            r["llm_calls"] += 1
            r["tokens"] += int(ev.get("total_tokens") or 0)
        elif etype == "message_posted":
            r["posts"] += 1
        elif etype == "message_received":
            r["received"] += 1
        elif etype == "tool_call":
            tool_calls.append(ev)
        elif etype == "terminal_emitted":
            terminal = ev
        elif etype == "scored":
            scored = ev

    # Check 3: a run_tests tool call whose result is a real {passed,timed_out} dict, not an error.
    real_tool = any(
        tc.get("tool") == "run_tests" and isinstance(tc.get("result"), dict) and "passed" in tc["result"]
        for tc in tool_calls
    )
    # Check 4: the harvested terminal mentioned the Conductor (the conductor only emits it when its
    # _mentions_conductor gate passed, so presence of the event implies the mention held).
    terminal_ok = bool(terminal) and terminal.get("mentions_conductor", True)
    checks = {
        "four_agents_connected": all(by_role[role]["connected"] for role in _AGENT_ROLES),
        "each_agent_llm_and_post": all(
            by_role[role]["llm_calls"] >= 1 and by_role[role]["posts"] >= 1 for role in _AGENT_ROLES
        ),
        "run_tests_ran": real_tool,
        "repairer_terminal_at_conductor": terminal_ok,
        "conductor_scored": bool(scored) and isinstance(scored.get("passed"), bool),
    }
    return {
        "by_role": dict(by_role),
        "tool_calls": tool_calls,
        "terminal": terminal,
        "scored": scored,
        "checks": checks,
    }
