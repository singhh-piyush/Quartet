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

from orchestrator.config import _PROVIDER_DEFAULTS, LOCAL_MODEL

_PATH = Path(__file__).resolve().parent / "run_config.json"
ROLES = ["spec", "coder", "tester", "repairer"]

# Cloud-first default topology: the four agents and the large competitor run on Groq so the app works on
# a fresh deploy with only a Groq key (or the server's shared key), no local model servers required.
# `local` stays fully selectable per role from the dashboard for a user who wants to run their own model.
# Override the seed with LLM_PROVIDER / {ROLE}_MODEL / LARGE_PROVIDER / LARGE_MODEL.
_DEFAULT_PROVIDER = os.environ.get("LLM_PROVIDER", "groq")
_DEFAULT_LARGE_PROVIDER = os.environ.get("LARGE_PROVIDER", "groq")

# Display/label model name for a slot left on the LOCAL provider (a local llama-server ignores the name;
# it serves whatever GGUF it loaded). The race lane + agent-card labels read from models_map.
_AGENTS_MODEL_DEFAULT = os.environ.get("AGENTS_MODEL", "WhiteRabbitNeo-2.5-Qwen-2.5-Coder-7B")

# Per-provider default large competitor: a genuinely larger single model for the race (4 small vs 1
# large). Override with LARGE_MODEL.
_LARGE_MODEL_BY_PROVIDER = {
    "groq": "llama-3.3-70b-versatile",
    "openrouter": "meta-llama/llama-3.3-70b-instruct",
    "gemini": "gemini-2.5-pro",
    "aimlapi": "gpt-4o",
    "local": os.environ.get("LARGE_MODEL", "Qwen3.6-35B-A3B"),
}


def _default_agent(role: str, provider: str) -> dict:
    env_model = os.environ.get(f"{role.upper()}_MODEL")
    if env_model:
        model = env_model
    elif provider in _PROVIDER_DEFAULTS:
        model = _PROVIDER_DEFAULTS[provider].get(role, _AGENTS_MODEL_DEFAULT)
    else:  # local / openai_compatible: name is cosmetic
        model = _AGENTS_MODEL_DEFAULT
    return {"provider": provider, "model": model}


def _default_large() -> dict:
    provider = _DEFAULT_LARGE_PROVIDER
    model = os.environ.get("LARGE_MODEL") or _LARGE_MODEL_BY_PROVIDER.get(provider, _AGENTS_MODEL_DEFAULT)
    return {"provider": provider, "model": model}


def defaults() -> dict:
    """Cloud-first seed (Groq by default). Env overrides LLM_PROVIDER / {ROLE}_MODEL / LARGE_* still win,
    and any slot can be switched to `local` (or another provider) from the dashboard."""
    provider = _DEFAULT_PROVIDER
    return {
        "name": "default",
        "agents": {role: _default_agent(role, provider) for role in ROLES},
        "large": _default_large(),
    }


def _merge(base: dict, override: dict) -> dict:
    """Fill base with any present override keys, keeping shape stable. `name` is a display label of the
    active stack; agent/large slots only ever carry provider + model (never a key)."""
    out = {"name": base.get("name", "default"), "agents": {}, "large": dict(base["large"])}
    override = override or {}
    if isinstance(override.get("name"), str) and override["name"].strip():
        out["name"] = override["name"].strip()
    ov_agents = override.get("agents", {})
    for role in ROLES:
        a = dict(base["agents"][role])
        a.update({k: v for k, v in ov_agents.get(role, {}).items() if k in ("provider", "model") and v})
        out["agents"][role] = a
    ov_large = override.get("large", {})
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
    """Persist a (possibly partial) config, merged over the CURRENT config so a partial update changes
    only the fields it carries and leaves the other slots intact. (load() already folds in defaults, so
    a fresh install still starts from the environment seed.) Returns the stored result."""
    merged = _merge(load(), cfg or {})
    _PATH.write_text(json.dumps(merged, indent=2))
    return merged


# Build-mode role defaults: the Coder runs Groq's gpt-oss-120b so a build produces good code fast in
# the demo. Applied only to slots the user has not moved off the local placeholder (see
# apply_build_defaults), so an explicit choice always wins.
BUILD_DEFAULTS = {"coder": {"provider": "groq", "model": "openai/gpt-oss-120b"}}
_LOCAL_PLACEHOLDERS = {_AGENTS_MODEL_DEFAULT, LOCAL_MODEL, "local-model"}


def apply_build_defaults(cfg: dict) -> dict:
    """Return cfg with BUILD_DEFAULTS overlaid onto any agent slot still at the local placeholder."""
    out = {**cfg, "agents": {r: dict(s) for r, s in cfg["agents"].items()}, "large": dict(cfg["large"])}
    for role, default in BUILD_DEFAULTS.items():
        slot = out["agents"].get(role, {})
        if slot.get("provider") == "local" and slot.get("model") in _LOCAL_PLACEHOLDERS:
            out["agents"][role] = dict(default)
    return out


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
