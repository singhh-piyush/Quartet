"""Config loader and provider-aware LLM client.

Featherless is unavailable; inference goes through `make_llm`, which routes to either a local
OpenAI-compatible server (default, free debugging) or AI/ML API based on LLM_PROVIDER.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

_CONFIG_PATH = Path(__file__).parent.parent / "agent_config.yaml"

LOCAL_BASE_URL = "http://localhost:8080/v1"
AIMLAPI_BASE_URL = "https://api.aimlapi.com/v1"

# Band platform REST base for the conductor (Agent API). The SDK RestClient defaults to a dev
# host, so the conductor passes this explicitly to share the agents' platform.
BAND_REST_URL = os.environ.get("BAND_REST_URL", "https://app.band.ai")

# Per-role default models on AI/ML API. PLACEHOLDERS - verify against aimlapi.com/models.
_AIML_DEFAULTS = {
    "spec": "Qwen/Qwen2.5-7B-Instruct-Turbo",
    "coder": "Qwen/Qwen2.5-Coder-32B-Instruct",
    "tester": "Qwen/Qwen2.5-Coder-7B-Instruct",
    "repairer": "Qwen/Qwen2.5-Coder-32B-Instruct",
}

# Local OpenAI-compatible server (llama.cpp / vLLM); the model name is usually ignored.
LOCAL_MODEL = os.environ.get("LOCAL_MODEL", "local-model")


@lru_cache(maxsize=1)
def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def get_agent(name: str) -> dict:
    """Return the agent block (agent_id, api_key) for the given agent name."""
    cfg = _load_config()
    agents = cfg.get("agents", {})
    if name not in agents:
        raise KeyError(f"Agent '{name}' not found in agent_config.yaml. Available: {list(agents)}")
    return agents[name]


def make_llm(role: str | None = None, *, model: str | None = None, **kwargs) -> ChatOpenAI:
    """Build an OpenAI-compatible chat client for the active provider (LLM_PROVIDER).

    local (default): one local server at LOCAL_BASE_URL, for free debugging.
    aimlapi: AI/ML API; the model is resolved from `model`, then the {ROLE}_MODEL env var,
    then the per-role placeholder default.
    An explicit `model=` overrides role-based resolution (used by the baselines).
    """
    provider = os.environ.get("LLM_PROVIDER", "local")

    if provider == "local":
        return ChatOpenAI(
            model=model or LOCAL_MODEL,
            base_url=LOCAL_BASE_URL,
            api_key="sk-local",
            **kwargs,
        )

    if provider == "aimlapi":
        api_key = os.environ.get("AIML_API_KEY")
        if not api_key:
            raise RuntimeError("AIML_API_KEY not set in environment")
        resolved = (
            model
            or (os.environ.get(f"{role.upper()}_MODEL") if role else None)
            or (_AIML_DEFAULTS.get(role) if role else None)
        )
        if not resolved:
            raise RuntimeError(f"no model for role {role!r}; set {role}_MODEL or pass model=")
        return ChatOpenAI(
            model=resolved,
            base_url=AIMLAPI_BASE_URL,
            api_key=api_key,
            **kwargs,
        )

    raise RuntimeError(f"unknown LLM_PROVIDER {provider!r}; use 'local' or 'aimlapi'")
