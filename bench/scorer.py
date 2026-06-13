# Scorer: computes Pass@1 against held-out official HumanEval tests.

from bench.sandbox import run_tests


def score(solutions: list[str], problems: list[dict], timeout: int = 10) -> dict:
    """Run each solution against its problem's official tests and aggregate Pass@1.

    solutions and problems are parallel lists. An empty/falsy solution counts as a
    fail without invoking the sandbox. Returns pass_count, total, pass_rate, and a
    per-problem results list.
    """
    results: list[dict] = []
    pass_count = 0

    for sol, prob in zip(solutions, problems):
        if not sol:
            r = {"passed": False, "error": "no solution generated", "timed_out": False}
        else:
            r = run_tests(sol, prob["test"], prob["entry_point"], timeout=timeout)

        pass_count += int(r["passed"])
        results.append(
            {
                "task_id": prob["task_id"],
                "passed": r["passed"],
                "timed_out": r["timed_out"],
                "error": (r["error"].splitlines()[0][:200] if r["error"] else None),
            }
        )

    n = len(results)
    return {
        "pass_count": pass_count,
        "total": n,
        "pass_rate": pass_count / n if n else 0.0,
        "results": results,
    }
