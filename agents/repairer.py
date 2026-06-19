# Repairer agent: runs the Tester's tests in a sandbox, routes failures back to the Coder,
# emits the final solution. In build mode it runs the whole multi-file project instead.
# Run: uv run python -m agents.repairer
import json
import logging
import os
import time
from pathlib import Path

from langchain_core.tools import tool

from agents.base import run_agent
from bench.events import emit
from bench.sandbox import parse_manifest, run_project as _run_project
from bench.sandbox import run_tests_detailed as _run_tests_detailed

# Cap how many per-assertion cases ride along on the tool_call event (structured test data, not
# message bodies). Enough to populate the demo's test panel without bloating the event line.
_MAX_CASES = 40


def _record_passing(files: list, ptype: str) -> None:
    """Persist the exact files that just passed run_project, keyed on this run. build_project delivers
    THESE (the sandbox-verified set) rather than the Repairer's re-typed FINAL_PROJECT, so a model that
    regenerates or hallucinates new content in its final message cannot replace the project that passed.
    Written next to (not inside) results/projects/<run_id>/ so build_project's dir wipe does not remove it."""
    run_id = os.environ.get("QUARTET_RUN_ID")
    if not run_id or not files:
        logging.info("[repairer] _record_passing skipped (run_id=%s files=%d)", run_id, len(files or []))
        return
    try:
        p = Path("results/projects") / f"{run_id}.passing.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"type": ptype, "files": files}), encoding="utf-8")
        logging.info("[repairer] recorded passing manifest (%d files) -> %s", len(files), p)
    except Exception as e:  # noqa: BLE001 - artifact write must never break the agent
        logging.warning("[repairer] _record_passing failed: %s", e)


@tool
def run_tests(solution_code: str, test_code: str, entry_point: str) -> dict:
    """Run the Coder's latest implementation against the Tester's check(candidate) function in
    an isolated sandbox. Pass the Coder's full implementation as solution_code, the Tester's
    check function as test_code, and the problem's function name as entry_point. Returns a dict
    with keys: passed (bool), error (str or None), timed_out (bool)."""
    start = time.monotonic()
    result = _run_tests_detailed(solution_code, test_code, entry_point)
    cases = result.get("cases") or []
    n_fail = sum(1 for c in cases if not c.get("passed"))
    first_fail = next((c for c in cases if not c.get("passed")), None)
    emit(
        "tool_call", role="repairer", tool="run_tests",
        args_summary=f"entry_point={entry_point} solution={len(solution_code)}B test={len(test_code)}B",
        result={
            "passed": result.get("passed"),
            "timed_out": result.get("timed_out"),
            "cases": cases[:_MAX_CASES],
            "n_total": len(cases),
            "n_fail": n_fail,
            "first_fail": (first_fail or {}).get("name"),
        },
        duration_ms=int((time.monotonic() - start) * 1000),
    )
    # The agent only needs the verdict and a failure trace to drive a repair round.
    return {
        "passed": result.get("passed"),
        "error": result.get("error"),
        "timed_out": result.get("timed_out"),
    }


@tool
def run_project(project_type: str = "python") -> dict:
    """Build and test the current multi-file project in an isolated sandbox (build mode).

    Set `project_type` to "python" (runs every test_*.py, or byte-compiles when there are none)
    or "static" (checks index.html). The tool automatically extracts the project files from the
    latest message in the chat history.
    Returns a dict with keys: passed (bool), error (str or None), timed_out (bool)."""
    start = time.monotonic()
    
    # Extract the most recent manifest from the transcript. Scan ALL messages and pick the
    # last Coder message that contains actual file blocks (largest one wins when there are
    # multiple repair rounds). This avoids "no valid files" when the Coder's message arrives
    # in the transcript log slightly after the Tester's handoff message.
    manifest = ""
    run_id = os.environ.get("QUARTET_RUN_ID")
    if run_id:
        transcript_path = Path("results/transcripts") / f"{run_id}.messages.jsonl"
        if transcript_path.exists():
            best_manifest = ""
            for line in transcript_path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    content = data.get("content", "")
                    # Accept any message that has file blocks; prefer Coder messages.
                    # Keep the LARGEST manifest seen (most complete project version).
                    if "=== FILE:" in content:
                        if len(content) > len(best_manifest):
                            best_manifest = content
                except json.JSONDecodeError:
                    pass
            manifest = best_manifest


    parsed = parse_manifest(manifest)
    files = parsed["files"]
    ptype = (parsed["type"] or project_type or "python").lower()
    result = _run_project(files, ptype)
    if result.get("passed") and files:
        _record_passing(files, ptype)  # the verified set build_project will deliver
    cases = result.get("cases") or []
    n_fail = sum(1 for c in cases if not c.get("passed"))
    first_fail = next((c for c in cases if not c.get("passed")), None)
    emit(
        "tool_call", role="repairer", tool="run_project",
        args_summary=f"type={ptype} files={len(files)}",
        result={
            "passed": result.get("passed"),
            "timed_out": result.get("timed_out"),
            "cases": cases[:_MAX_CASES],
            "n_total": result.get("n_total", len(cases)),
            "n_fail": n_fail,
            "first_fail": (first_fail or {}).get("name"),
        },
        duration_ms=int((time.monotonic() - start) * 1000),
    )
    return {
        "passed": result.get("passed"),
        "error": result.get("error"),
        "timed_out": result.get("timed_out"),
    }


if __name__ == "__main__":
    # Build mode swaps the single-function test tool for the multi-file project runner.
    _tool = run_project if os.environ.get("QUARTET_MODE") == "build" else run_tests
    run_agent("repairer", tools=[_tool])
