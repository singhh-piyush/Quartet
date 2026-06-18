# Repairer agent: runs the Tester's tests in a sandbox, routes failures back to the Coder,
# emits the final solution. In build mode it runs the whole multi-file project instead.
# Run: uv run python -m agents.repairer
import os
import time

from langchain_core.tools import tool

from agents.base import run_agent
from bench.events import emit
from bench.sandbox import parse_manifest, run_project as _run_project
from bench.sandbox import run_tests_detailed as _run_tests_detailed

# Cap how many per-assertion cases ride along on the tool_call event (structured test data, not
# message bodies). Enough to populate the demo's test panel without bloating the event line.
_MAX_CASES = 40


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
def run_project(manifest: str, project_type: str = "python") -> dict:
    """Build and test the current multi-file project in an isolated sandbox (build mode).

    Pass `manifest` as the full set of project files in this exact format, one block per file:
        === FILE: path/to/file ===
        ```
        <file content>
        ```
    Include the Coder's code files AND the Tester's test_*.py files. Set `project_type` to "python"
    (runs every test_*.py, or byte-compiles when there are none) or "static" (checks index.html).
    Returns a dict with keys: passed (bool), error (str or None), timed_out (bool)."""
    start = time.monotonic()
    parsed = parse_manifest(manifest)
    files = parsed["files"]
    ptype = (parsed["type"] or project_type or "python").lower()
    result = _run_project(files, ptype)
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
