# Repairer agent: runs the Tester's tests in a sandbox, routes failures back to the Coder,
# emits the final solution. Run: uv run python -m agents.repairer
import time

from langchain_core.tools import tool

from agents.base import run_agent
from bench.events import emit
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


if __name__ == "__main__":
    run_agent("repairer", tools=[run_tests])
