"""Model pricing + cost derivation for the Stack Lab.

Cost is real: it is the tokens the agents actually logged (llm_call events carry prompt_tokens /
completion_tokens) times a per-model price table. The table lives at results/lab/pricing.json as
{model: {input, output}} in dollars per 1M tokens. It is NOT a secret (no keys), so unlike the
provider key store it lives on disk and is editable from the dashboard.

Seeds (already staged in pricing.json): gpt-oss-120b 0.15/0.75, gpt-oss-20b 0.10/0.50 per 1M.
"""

from __future__ import annotations

import json
from pathlib import Path

_PRICING_PATH = Path(__file__).resolve().parent.parent / "results" / "lab" / "pricing.json"

# Fallback when a model is not in the table. Deliberately non-zero so an un-priced cloud model does not
# read as free; the user can add a real row to pricing.json. A local model should be priced 0 explicitly.
_DEFAULT_PRICE = {"input": 0.5, "output": 1.5}

_NOTE = "Dollars per 1M tokens (input / output). Edit freely; the lab uses these for cost."


def load_pricing() -> dict:
    """The full price table {model: {input, output}} (plus a leading _note). Empty-ish default if absent."""
    try:
        data = json.loads(_PRICING_PATH.read_text())
        if isinstance(data, dict):
            return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        pass
    return {"_note": _NOTE}


def _rates(table: dict) -> dict:
    """Drop the _note (and any non-rate keys) so only {model: {input, output}} remains."""
    return {k: v for k, v in table.items() if isinstance(v, dict) and ("input" in v or "output" in v)}


def save_pricing(table: dict) -> dict:
    """Persist a full or partial price table, merged over the current one (so a single-row edit keeps the
    rest). Coerces rates to floats and keeps the _note. Returns the stored table."""
    current = load_pricing()
    out: dict = {"_note": current.get("_note") or _NOTE}
    out.update(_rates(current))
    for model, rate in _rates(table or {}).items():
        merged = dict(out.get(model) or {})
        if rate.get("input") is not None:
            merged["input"] = float(rate["input"])
        if rate.get("output") is not None:
            merged["output"] = float(rate["output"])
        out[model] = {"input": float(merged.get("input", 0.0)), "output": float(merged.get("output", 0.0))}
    _PRICING_PATH.parent.mkdir(parents=True, exist_ok=True)
    _PRICING_PATH.write_text(json.dumps(out, indent=2))
    return out


def price_for(model: str, table: dict | None = None) -> dict:
    """The {input, output} per-1M rate for a model, falling back to _DEFAULT_PRICE when unlisted."""
    rates = _rates(table if table is not None else load_pricing())
    return rates.get(model) or dict(_DEFAULT_PRICE)


def cost_usd(model: str, prompt_tokens: int, completion_tokens: int, table: dict | None = None) -> float:
    """Cost in dollars for one model call's tokens, priced per 1M."""
    rate = price_for(model, table)
    return (int(prompt_tokens or 0) * rate["input"] + int(completion_tokens or 0) * rate["output"]) / 1_000_000


def cost_from_events(events: list[dict], table: dict | None = None) -> dict:
    """Aggregate cost + tokens over a run's llm_call events.

    Returns {total: {prompt, completion, total, cost_usd}, by_role: {role: {...}}, by_model: {...}}.
    Groups by the event's role and model so the lab can show where the spend went.
    """
    table = table if table is not None else load_pricing()
    total = {"prompt": 0, "completion": 0, "total": 0, "cost_usd": 0.0}
    by_role: dict[str, dict] = {}
    by_model: dict[str, dict] = {}

    for ev in events:
        if ev.get("type") != "llm_call":
            continue
        role = ev.get("role") or "unknown"
        model = ev.get("model") or ""
        pt = int(ev.get("prompt_tokens") or 0)
        ct = int(ev.get("completion_tokens") or 0)
        tt = int(ev.get("total_tokens") or (pt + ct))
        c = cost_usd(model, pt, ct, table)
        for bucket, key in ((by_role, role), (by_model, model or "unknown")):
            slot = bucket.setdefault(key, {"prompt": 0, "completion": 0, "total": 0, "cost_usd": 0.0})
            slot["prompt"] += pt
            slot["completion"] += ct
            slot["total"] += tt
            slot["cost_usd"] += c
        total["prompt"] += pt
        total["completion"] += ct
        total["total"] += tt
        total["cost_usd"] += c

    total["cost_usd"] = round(total["cost_usd"], 6)
    for bucket in (by_role, by_model):
        for slot in bucket.values():
            slot["cost_usd"] = round(slot["cost_usd"], 6)
    return {"total": total, "by_role": by_role, "by_model": by_model}


def _selftest() -> bool:
    table = load_pricing()
    ok = True
    # Seeds present and correct.
    p120 = price_for("openai/gpt-oss-120b", table)
    p20 = price_for("openai/gpt-oss-20b", table)
    checks = [
        ("gpt-oss-120b input 0.15", abs(p120["input"] - 0.15) < 1e-9),
        ("gpt-oss-120b output 0.75", abs(p120["output"] - 0.75) < 1e-9),
        ("gpt-oss-20b input 0.10", abs(p20["input"] - 0.10) < 1e-9),
        ("gpt-oss-20b output 0.50", abs(p20["output"] - 0.50) < 1e-9),
    ]
    # 1M prompt + 1M completion on gpt-oss-120b = 0.15 + 0.75 = 0.90.
    c = cost_usd("openai/gpt-oss-120b", 1_000_000, 1_000_000, table)
    checks.append(("cost_usd 1M+1M = 0.90", abs(c - 0.90) < 1e-9))
    # Unknown model falls back, not zero.
    checks.append(("unknown model fallback", price_for("nope/not-a-model", table)["input"] > 0))
    # Aggregation over two events.
    agg = cost_from_events(
        [
            {"type": "llm_call", "role": "coder", "model": "openai/gpt-oss-120b", "prompt_tokens": 1_000_000, "completion_tokens": 0},
            {"type": "llm_call", "role": "spec", "model": "openai/gpt-oss-20b", "prompt_tokens": 0, "completion_tokens": 1_000_000},
            {"type": "message_posted", "role": "coder"},
        ],
        table,
    )
    checks.append(("agg total cost 0.15+0.50", abs(agg["total"]["cost_usd"] - 0.65) < 1e-6))
    checks.append(("agg by_role coder", abs(agg["by_role"]["coder"]["cost_usd"] - 0.15) < 1e-6))
    for name, good in checks:
        print(f"{'OK  ' if good else 'FAIL'} {name}")
        ok = ok and good
    return ok


if __name__ == "__main__":
    import sys

    print("pricing selftest:", "PASS" if _selftest() else "FAIL")
    sys.exit(0)
