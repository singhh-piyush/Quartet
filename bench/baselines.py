# Baselines: single-small and single-large one-shot provider calls (no Band).
# These are the floor (single-small) and the bar (single-large) the Quartet must beat/match.

import argparse
import json
import logging
import re
import time
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from bench.dataset import get_problem, get_problems
from bench.events import emit
from bench.sandbox import run_tests
from bench.scorer import score
from orchestrator.config import make_llm

# PLACEHOLDERS - verify against aimlapi.com/models before trusting numbers.
SMALL_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct"
LARGE_MODEL = "Qwen/Qwen2.5-Coder-32B-Instruct"

SYSTEM_PROMPT = (
    "You are an expert Python programmer. Implement the requested function. "
    "Return the complete function, including any imports it needs, in a single "
    "```python code block. Do not add explanation."
)

_RESULTS_PATH = Path("results/baselines.json")
_CODE_BLOCK = re.compile(r"```(?:python)?\s*\n(.*?)```", re.DOTALL)

_MAX_RETRIES = 3
_RETRY_BACKOFF = 2.0


def extract_code(text: str) -> str:
    """Pull the first fenced code block out of a model response, else return raw text."""
    m = _CODE_BLOCK.search(text)
    return (m.group(1) if m else text).strip()


def build_solution(completion: str, problem: dict) -> str:
    """Turn a raw completion into runnable solution code.

    If the completion already defines the entry-point function, use it as-is. Otherwise
    treat it as a bare body and prepend the original prompt (signature + imports).
    """
    code = extract_code(completion)
    if f"def {problem['entry_point']}" in code:
        return code
    return problem["prompt"] + code


def _complete(client, problem: dict) -> tuple[str, int]:
    """Invoke the model once for a problem. Returns (raw_text, total_tokens).

    Retries transient failures; returns ("", 0) if every attempt fails.
    """
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=problem["prompt"]),
    ]
    for attempt in range(_MAX_RETRIES):
        try:
            resp = client.invoke(messages)
            text = resp.content if isinstance(resp.content, str) else str(resp.content)
            tokens = 0
            usage = getattr(resp, "usage_metadata", None)
            if usage:
                tokens = usage.get("total_tokens", 0)
            else:
                tokens = resp.response_metadata.get("token_usage", {}).get("total_tokens", 0)
            return text, tokens
        except Exception as e:
            if attempt == _MAX_RETRIES - 1:
                print(f"  {problem['task_id']}: generation failed after {_MAX_RETRIES} tries: {e}")
                return "", 0
            time.sleep(_RETRY_BACKOFF * (attempt + 1))
    return "", 0


def one_shot(model: str, problem: dict, client=None) -> str:
    """Send one HumanEval problem to a provider model, return the extracted solution code."""
    client = client or make_llm(model=model, temperature=0, max_tokens=1024)
    text, _ = _complete(client, problem)
    return build_solution(text, problem) if text else ""


def run_live(model: str, problem: dict, role: str = "single_large") -> dict:
    """One-shot `model` on a single problem, emitting telemetry to QUARTET_EVENTS_PATH so the demo
    can race the lone large model against the Quartet live. Scores against the held-out official
    test (the same hidden test the conductor uses for the Quartet). Returns a small record.

    Provider/model come from the spawning environment (the launcher sets LLM_PROVIDER and the model
    for this process), so the large competitor can be the local server or a cloud model unchanged.
    """
    task_id = problem["task_id"]
    emit("baseline_started", role=role, task_id=task_id, model=model)
    start = time.monotonic()
    tokens = 0
    solution = ""
    try:
        client = make_llm(model=model, temperature=0, max_tokens=1024)
        text, tokens = _complete(client, problem)
        solution = build_solution(text, problem) if text else ""
    except Exception as e:  # noqa: BLE001 - a provider error must surface as a lost race, not a crash
        logging.warning("[%s] %s generation failed: %s", task_id, role, e)
    duration_ms = int((time.monotonic() - start) * 1000)
    emit("llm_call", role=role, task_id=task_id, model=model,
         prompt_tokens=0, completion_tokens=0, total_tokens=tokens, duration_ms=duration_ms)
    emit("baseline_solution", role=role, task_id=task_id, preview=solution)
    if solution:
        result = run_tests(solution, problem["test"], problem["entry_point"])
    else:
        result = {"passed": False, "error": "no solution generated", "timed_out": False}
    emit("scored", role=role, task_id=task_id, passed=bool(result["passed"]),
         status="FINAL_SOLUTION" if solution else "NO_SOLUTION")
    return {
        "task_id": task_id, "model": model, "role": role,
        "passed": bool(result["passed"]), "total_tokens": tokens,
        "duration_ms": duration_ms, "solution": solution,
    }


def run_config(model: str, problems: list[dict]) -> dict:
    """Run one model over all problems one-shot, score it, and tally tokens."""
    client = make_llm(model=model, temperature=0, max_tokens=1024)
    solutions: list[str] = []
    total_tokens = 0

    for p in problems:
        text, tokens = _complete(client, p)
        total_tokens += tokens
        solutions.append(build_solution(text, p) if text else "")

    result = score(solutions, problems)
    result["model"] = model
    result["total_tokens"] = total_tokens
    result["solutions"] = solutions
    return result


def main() -> None:
    ap = argparse.ArgumentParser(description="Run single-model HumanEval baselines.")
    ap.add_argument("--n", type=int, default=10, help="number of problems (default 10)")
    ap.add_argument("--live", action="store_true", help="emit telemetry for one task (demo race lane)")
    ap.add_argument("--task", help="single HumanEval task id (used with --live)")
    ap.add_argument("--model", help="model to run (used with --live; default the large baseline)")
    ap.add_argument("--role", default="single_large", help="event role for the live lane")
    args = ap.parse_args()

    if args.live:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        if not args.task:
            ap.error("--live requires --task")
        problem = get_problem(args.task)
        model = args.model or LARGE_MODEL
        rec = run_live(model, problem, role=args.role)
        print(f"{args.role} {rec['task_id']}: passed={rec['passed']} tokens={rec['total_tokens']} model={model}")
        return

    problems = get_problems(n=args.n)
    out = {}

    for label, model in [("single_small", SMALL_MODEL), ("single_large", LARGE_MODEL)]:
        print(f"Running {label}: {model} over {len(problems)} problems...")
        res = run_config(model, problems)
        out[label] = res
        print(
            f"{label} ({model}): {res['pass_count']}/{res['total']} "
            f"pass@1={res['pass_rate']:.1%} tokens={res['total_tokens']}"
        )

    _RESULTS_PATH.parent.mkdir(exist_ok=True)
    _RESULTS_PATH.write_text(json.dumps(out, indent=2))
    print(f"Saved {_RESULTS_PATH}")


if __name__ == "__main__":
    main()
