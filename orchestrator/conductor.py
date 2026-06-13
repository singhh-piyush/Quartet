"""Conductor: drives the Quartet over the benchmark through Band.

The conductor is a scripted Agent-API client (a 5th "Conductor" agent), not an LLM agent. Per
problem it opens a room, adds the four agents, posts the problem mentioning @Spec, then harvests
the Repairer's terminal message (which @mentions the Conductor) from its own message queue and
scores the harvested solution against the held-out official test. The agents never see the
official test; the conductor holds it for scoring only.

The Human API is Enterprise-only and 403s on Pro, so everything here uses the agent_api_*
resources, authenticated with the conductor's agent API key (sent as X-API-Key by RestClient).

Run: uv run python -m orchestrator.conductor [--n N] [--timeout S] [--poll S] [--selftest]
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
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

from bench.sandbox import run_tests
from orchestrator.config import BAND_REST_URL, get_agent

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


def _safe(fn, *args, **kwargs):
    """Best-effort call; swallow and log any error (used for queue housekeeping)."""
    try:
        return fn(*args, **kwargs)
    except Exception as e:  # noqa: BLE001 - housekeeping must not abort the run
        logging.debug("ignored error in %s: %s", getattr(fn, "__name__", fn), e)
        return None


def _msg_ts(msg) -> float:
    ts = getattr(msg, "inserted_at", None)
    return ts.timestamp() if ts else 0.0


def open_room(client: RestClient, problem: dict, agent_ids: dict) -> str:
    """Create a room for the problem and add the four agents as participants."""
    resp = _with_retry(
        client.agent_api_chats.create_agent_chat,
        chat=ChatRoomRequest(task_id=problem["task_id"]),
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
    content = f"@Spec solve this so it passes the hidden tests.\n\n{problem['prompt']}"
    _with_retry(
        client.agent_api_messages.create_agent_chat_message,
        room_id,
        message=ChatMessageRequest(
            content=content,
            mentions=[ChatMessageRequestMentionsItem(id=spec_id, name="Spec")],
        ),
    )
    logging.info("[%s] posted problem, mentioned @Spec", problem["task_id"])


def harvest(client: RestClient, room_id: str, repairer_id: str, deadline: float, poll: float):
    """Poll the conductor's own queue until the Repairer's terminal message or the deadline.

    Returns ('FINAL_SOLUTION', code) | ('NO_SOLUTION', '') | ('TIMEOUT', '').
    """
    seen: set[str] = set()
    while time.monotonic() < deadline:
        resp = _with_retry(client.agent_api_messages.list_agent_messages, room_id, status="pending")
        for msg in sorted(resp.data, key=_msg_ts):
            if msg.id in seen:
                continue
            seen.add(msg.id)
            from_repairer = msg.sender_id == repairer_id or (msg.sender_name or "").lower() == "repairer"
            status, solution = classify(msg.content) if from_repairer else (None, "")
            # Consume the message from our queue (best-effort) so it does not reappear.
            _safe(client.agent_api_messages.mark_agent_message_processed, room_id, msg.id)
            if status:
                return status, solution
        time.sleep(poll)
    return "TIMEOUT", ""


def run_problem(client: RestClient, problem: dict, agent_ids: dict, timeout: float, poll: float) -> dict:
    """Drive one problem end to end and score the harvested solution against the official test."""
    start = time.monotonic()
    room_id = open_room(client, problem, agent_ids)
    post_problem(client, room_id, problem, agent_ids["spec"])
    status, solution = harvest(client, room_id, agent_ids["repairer"], time.monotonic() + timeout, poll)

    record = {
        "task_id": problem["task_id"],
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

    logging.info(
        "[%s] %s passed=%s (%.1fs)",
        problem["task_id"], status, record["passed"], time.monotonic() - start,
    )
    return record


def run_benchmark(n: int, timeout: float, poll: float, out_path: str) -> dict:
    """Run the Quartet over n problems through Band and save results/quartet_local.json."""
    from bench.dataset import get_problems

    problems = get_problems(n)
    agent_ids = {role: get_agent(role)["agent_id"] for role in ROLES}
    client = make_client()

    results = []
    for problem in problems:
        try:
            results.append(run_problem(client, problem, agent_ids, timeout, poll))
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
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description="Drive the Quartet over HumanEval through Band (Agent API).")
    ap.add_argument("--n", type=int, default=3, help="number of problems (default 3, dry run)")
    ap.add_argument("--timeout", type=float, default=180.0, help="per-problem timeout in seconds")
    ap.add_argument("--poll", type=float, default=2.0, help="harvest poll interval in seconds")
    ap.add_argument("--out", default=_DEFAULT_OUT, help=f"results path (default {_DEFAULT_OUT})")
    ap.add_argument("--selftest", action="store_true", help="offline parse+score check, no Band")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.selftest:
        ok = _selftest()
        print("\nselftest:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)

    run_benchmark(args.n, args.timeout, args.poll, args.out)


if __name__ == "__main__":
    main()
