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


def aimlapi_key() -> str | None:
    """The aimlapi inference key. Looked up in order: AIML_API_KEY env / .env, then agent_config.yaml
    so all credentials can live in one file if preferred. Accepts a top-level `aiml_api_key:` or a
    nested `providers: {aimlapi: {api_key: ...}}`. This is the LLM key, distinct from the per-agent
    `band_*` keys (which authenticate the Band chat room, not model inference)."""
    env = os.environ.get("AIML_API_KEY")
    if env:
        return env
    # Read fresh (not the lru_cached _load_config) so a key added to agent_config.yaml while the
    # demo server is running is picked up on the next run without a restart.
    try:
        with open(_CONFIG_PATH) as f:
            cfg = yaml.safe_load(f) or {}
    except FileNotFoundError:
        return None
    key = cfg.get("aiml_api_key") or cfg.get("aimlapi_api_key")
    if not key:
        key = ((cfg.get("providers") or {}).get("aimlapi") or {}).get("api_key")
    return key or None


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
        api_key = aimlapi_key()
        if not api_key:
            raise RuntimeError(
                "no aimlapi key found. Set AIML_API_KEY in .env, or add `aiml_api_key: <key>` to "
                "agent_config.yaml. Note: this must be an aimlapi inference key, not a band_ chat key."
            )
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
