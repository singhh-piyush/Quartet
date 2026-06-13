# Baselines: single-small and single-large one-shot Featherless calls (no Band).
# These are the floor (single-small) and the bar (single-large) the Quartet must beat/match.

import argparse
import json
import re
import time
from pathlib import Path

from langchain_core.messages import HumanMessage, SystemMessage

from band.config import featherless_client
from bench.dataset import get_problems
from bench.scorer import score

# PLACEHOLDERS - verify both exist in the live Featherless catalog before trusting numbers.
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
    """Send one HumanEval problem to a Featherless model, return the extracted solution code."""
    client = client or featherless_client(model, temperature=0, max_tokens=1024)
    text, _ = _complete(client, problem)
    return build_solution(text, problem) if text else ""


def run_config(model: str, problems: list[dict]) -> dict:
    """Run one model over all problems one-shot, score it, and tally tokens."""
    client = featherless_client(model, temperature=0, max_tokens=1024)
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
    args = ap.parse_args()

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
