# Tester agent: writes check(candidate) tests. Run: uv run python -m agents.tester
from agents.base import run_agent

if __name__ == "__main__":
    run_agent("tester")
