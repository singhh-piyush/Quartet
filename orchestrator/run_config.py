"""Per-run model selection for the four agents and the single large competitor.

Holds model NAMES and the provider only, never API keys. Edited from the dashboard (the demo
server reads/writes it) and read by the launcher (to spawn each agent process with its chosen
model) and by the conductor (to label a run with the models in play). Each agent is its own
process, so each may run a different provider/model: the launcher sets LLM_PROVIDER and the
per-role {ROLE}_MODEL env var that orchestrator.config.make_llm already understands.

The file lives next to this module as run_config.json (gitignored). When absent or partial, values
fall back to the environment defaults so the system still runs with no dashboard interaction.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from orchestrator.config import _AIML_DEFAULTS, LOCAL_MODEL

_PATH = Path(__file__).resolve().parent / "run_config.json"
ROLES = ["spec", "coder", "tester", "repairer"]

# Display/label model names for the default two-server local topology. These drive the UI agent-card
# labels and the race lane (via models_map); for a local llama-server the name is otherwise cosmetic
# (the server serves whatever GGUF it loaded). The agents run a small coder model (:8081); the large
# competitor is Qwen3.6 (:8080). Override with AGENTS_MODEL / LARGE_MODEL.
_AGENTS_MODEL_DEFAULT = os.environ.get("AGENTS_MODEL", "WhiteRabbitNeo-2.5-Qwen-2.5-Coder-7B")
_LARGE_MODEL_DEFAULT = os.environ.get("LARGE_MODEL", "Qwen3.6-35B-A3B")


def _default_agent(role: str, provider: str) -> dict:
    env_model = os.environ.get(f"{role.upper()}_MODEL")
    if env_model:
        model = env_model
    elif provider == "aimlapi":
        model = _AIML_DEFAULTS.get(role, LOCAL_MODEL)
    else:
        model = _AGENTS_MODEL_DEFAULT
    return {"provider": provider, "model": model}


def defaults() -> dict:
    """Seed config from the environment (LLM_PROVIDER + *_MODEL); large competitor runs local."""
    provider = os.environ.get("LLM_PROVIDER", "local")
    return {
        "agents": {role: _default_agent(role, provider) for role in ROLES},
        "large": {
            "provider": "local",
            "model": _LARGE_MODEL_DEFAULT,
        },
    }


def _merge(base: dict, override: dict) -> dict:
    """Fill base with any present override keys, keeping shape stable."""
    out = {"agents": {}, "large": dict(base["large"])}
    ov_agents = (override or {}).get("agents", {})
    for role in ROLES:
        a = dict(base["agents"][role])
        a.update({k: v for k, v in ov_agents.get(role, {}).items() if k in ("provider", "model") and v})
        out["agents"][role] = a
    ov_large = (override or {}).get("large", {})
    out["large"].update({k: v for k, v in ov_large.items() if k in ("provider", "model") and v})
    return out


def load() -> dict:
    """Return the saved config merged over environment defaults (so missing keys are filled)."""
    try:
        saved = json.loads(_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return defaults()
    return _merge(defaults(), saved)


def save(cfg: dict) -> dict:
    """Persist a (possibly partial) config merged over defaults; return the stored result."""
    merged = _merge(defaults(), cfg or {})
    _PATH.write_text(json.dumps(merged, indent=2))
    return merged


def role_env(role: str, cfg: dict | None = None) -> dict:
    """Env overrides to spawn one agent process with its selected provider/model."""
    cfg = cfg or load()
    a = cfg["agents"][role]
    return {"LLM_PROVIDER": a["provider"], f"{role.upper()}_MODEL": a["model"]}


def models_map(cfg: dict | None = None) -> dict:
    """role -> model string, including the single_large competitor, for run labeling and the UI."""
    cfg = cfg or load()
    out = {role: cfg["agents"][role]["model"] for role in ROLES}
    out["single_large"] = cfg["large"]["model"]
    return out
