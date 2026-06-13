# Repairer agent: runs the Tester's tests in a sandbox, routes failures back to the Coder,
# emits the final solution. Run: uv run python -m agents.repairer
from langchain_core.tools import tool

from agents.base import run_agent
from bench.sandbox import run_tests as _run_tests


@tool
def run_tests(solution_code: str, test_code: str, entry_point: str) -> dict:
    """Run the Coder's latest implementation against the Tester's check(candidate) function in
    an isolated sandbox. Pass the Coder's full implementation as solution_code, the Tester's
    check function as test_code, and the problem's function name as entry_point. Returns a dict
    with keys: passed (bool), error (str or None), timed_out (bool)."""
    return _run_tests(solution_code, test_code, entry_point)


if __name__ == "__main__":
    run_agent("repairer", tools=[run_tests])
