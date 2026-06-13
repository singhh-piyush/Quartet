import random

from datasets import load_dataset

DATASET_ID = "openai/openai_humaneval"
SEED = 0


def get_problems(n: int = 30) -> list[dict]:
    """Return the n hardest HumanEval problems, ranked by canonical solution length."""
    random.seed(SEED)
    ds = load_dataset(DATASET_ID, split="test")

    def _difficulty(row: dict) -> int:
        return sum(1 for line in row["canonical_solution"].splitlines() if line.strip())

    rows = sorted(ds, key=lambda r: (-_difficulty(r), r["task_id"]))[:n]
    return [
        {
            "task_id": r["task_id"],
            "prompt": r["prompt"],
            "entry_point": r["entry_point"],
            "test": r["test"],
            "canonical_solution": r["canonical_solution"],
        }
        for r in rows
    ]
