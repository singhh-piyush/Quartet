"""Config loader and provider-aware LLM client.

Featherless is unavailable; inference goes through `make_llm`, which routes to either a local
OpenAI-compatible server (default, free debugging) or AI/ML API based on LLM_PROVIDER.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

_CONFIG_PATH = Path(__file__).parent.parent / "agent_config.yaml"

# Server-side key store for the cloud providers, written by the dashboard ("Build your stack"). Keyed
# by provider, gitignored, never returned to the client. Shape:
#   {"groq": {"api_key": "..."},
#    "aimlapi": {"api_key": "..."},
#    "openai_compatible": {"base_url": "...", "api_key": "..."}}
# This holds inference keys only; the band_ chat-room keys stay in agent_config.yaml.
_PROVIDER_KEYS_PATH = Path(__file__).parent / "provider_keys.json"

# Local OpenAI-compatible endpoints. Two servers in the default topology: the four agents run a small
# coder model on :8081, the large competitor runs Qwen3.6 on :8080. make_llm uses LOCAL_BASE_URL, which
# the launcher sets per process (agents -> LOCAL_AGENTS_URL, large -> LOCAL_LARGE_URL) so each hits its
# own server. The default keeps :8080 for back-compat when nothing sets it.
LOCAL_BASE_URL = os.environ.get("LOCAL_BASE_URL", "http://localhost:8080/v1")
LOCAL_LARGE_URL = os.environ.get("LOCAL_LARGE_URL", "http://localhost:8080/v1")
LOCAL_AGENTS_URL = os.environ.get("LOCAL_AGENTS_URL", "http://localhost:8081/v1")
AIMLAPI_BASE_URL = "https://api.aimlapi.com/v1"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# The cloud providers selectable from the dashboard, with their fixed OpenAI-compatible base. local has
# no fixed base (per-process LOCAL_BASE_URL) and openai_compatible carries a user base in the key store.
PROVIDERS = ("local", "groq", "aimlapi", "openai_compatible")
_PROVIDER_BASE = {"groq": GROQ_BASE_URL, "aimlapi": AIMLAPI_BASE_URL}

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

# Per-role default models on Groq (verified against api.groq.com/openai/v1/models; the dashboard
# dropdown pulls the live list at runtime, so these are only the seed when nothing is selected).
_GROQ_DEFAULTS = {
    "spec": "openai/gpt-oss-20b",
    "coder": "openai/gpt-oss-120b",
    "tester": "llama-3.3-70b-versatile",
    "repairer": "openai/gpt-oss-120b",
}

# Local OpenAI-compatible server (llama.cpp / vLLM); the model name is usually ignored.
LOCAL_MODEL = os.environ.get("LOCAL_MODEL", "local-model")


@lru_cache(maxsize=1)
def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _read_provider_keys() -> dict:
    """The server-side provider key store, read fresh so a key entered in the dashboard while the
    demo server is running is picked up on the next run. Returns {} when absent/unreadable."""
    try:
        return json.loads(_PROVIDER_KEYS_PATH.read_text()) or {}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def aimlapi_key() -> str | None:
    """The aimlapi inference key. Looked up in order: AIML_API_KEY env / .env, then the dashboard key
    store (provider_keys.json), then agent_config.yaml so all credentials can live in one file if
    preferred. Accepts a top-level `aiml_api_key:` or a nested `providers: {aimlapi: {api_key: ...}}`.
    This is the LLM key, distinct from the per-agent `band_*` keys (which authenticate the Band chat
    room, not model inference)."""
    env = os.environ.get("AIML_API_KEY")
    if env:
        return env
    store_key = (_read_provider_keys().get("aimlapi") or {}).get("api_key")
    if store_key:
        return store_key
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


def save_provider_key(provider: str, api_key: str | None = None, base_url: str | None = None) -> dict:
    """Write a provider's secret to the gitignored key store, merging with what is there. Used by the
    dashboard. Returns key_status() (booleans only, never the key)."""
    if provider not in ("groq", "aimlapi", "openai_compatible"):
        raise ValueError(f"provider {provider!r} does not take a key")
    store = _read_provider_keys()
    entry = dict(store.get(provider) or {})
    if api_key is not None and api_key.strip():
        entry["api_key"] = api_key.strip()
    if base_url is not None and base_url.strip():
        entry["base_url"] = base_url.strip()
    store[provider] = entry
    _PROVIDER_KEYS_PATH.write_text(json.dumps(store, indent=2))
    return key_status()


def key_status() -> dict:
    """Which providers have a usable secret, plus the non-secret openai_compatible base_url. Never
    includes a key value, so it is safe to return to the client."""
    oc = provider_secret("openai_compatible")
    return {
        "groq": {"has_key": bool(provider_secret("groq").get("api_key"))},
        "aimlapi": {"has_key": bool(provider_secret("aimlapi").get("api_key"))},
        "openai_compatible": {"has_key": bool(oc.get("api_key")), "base_url": oc.get("base_url") or ""},
    }


def provider_secret(provider: str) -> dict:
    """Resolve {base_url?, api_key?} for a cloud provider from the environment first, then the
    dashboard key store. Never raises; missing values are simply absent so callers give a clear error.

      groq               -> {api_key} from GROQ_API_KEY env / store
      aimlapi            -> {api_key} via aimlapi_key() (env / store / agent_config.yaml)
      openai_compatible  -> {base_url, api_key} from OPENAI_COMPAT_* env / store
      local              -> {} (uses the per-process LOCAL_BASE_URL, no key)
    """
    store = _read_provider_keys().get(provider) or {}
    if provider == "aimlapi":
        key = aimlapi_key()
        return {"api_key": key} if key else {}
    if provider == "groq":
        key = os.environ.get("GROQ_API_KEY") or store.get("api_key")
        return {"api_key": key} if key else {}
    if provider == "openai_compatible":
        out = {}
        base = os.environ.get("OPENAI_COMPAT_BASE_URL") or store.get("base_url")
        key = os.environ.get("OPENAI_COMPAT_API_KEY") or store.get("api_key")
        if base:
            out["base_url"] = base
        if key:
            out["api_key"] = key
        return out
    return {}


def get_agent(name: str) -> dict:
    """Return the agent block (agent_id, api_key) for the given agent name."""
    cfg = _load_config()
    agents = cfg.get("agents", {})
    if name not in agents:
        raise KeyError(f"Agent '{name}' not found in agent_config.yaml. Available: {list(agents)}")
    return agents[name]


def _resolve_model(role: str | None, model: str | None, defaults: dict) -> str | None:
    """Model resolution shared by the keyed providers: explicit model=, then {ROLE}_MODEL, then the
    per-role default seed."""
    return (
        model
        or (os.environ.get(f"{role.upper()}_MODEL") if role else None)
        or (defaults.get(role) if role else None)
    )


def make_llm(role: str | None = None, *, model: str | None = None, **kwargs) -> ChatOpenAI:
    """Build an OpenAI-compatible chat client for the active provider (LLM_PROVIDER).

    local (default): one local server at LOCAL_BASE_URL, for free debugging.
    groq / aimlapi / openai_compatible: hosted OpenAI-compatible endpoints; the model is resolved from
    `model`, then the {ROLE}_MODEL env var, then the per-role default seed. Keys/base_url come from
    provider_secret() (env or the dashboard key store).
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

    if provider in ("aimlapi", "groq"):
        secret = provider_secret(provider)
        api_key = secret.get("api_key")
        if not api_key:
            raise RuntimeError(
                f"no {provider} key found. Add it in the dashboard (Build your stack), set "
                f"{'AIML_API_KEY' if provider == 'aimlapi' else 'GROQ_API_KEY'} in .env, or put it in "
                "orchestrator/provider_keys.json. Note: this is an inference key, not a band_ chat key."
            )
        defaults = _AIML_DEFAULTS if provider == "aimlapi" else _GROQ_DEFAULTS
        resolved = _resolve_model(role, model, defaults)
        if not resolved:
            raise RuntimeError(f"no model for role {role!r}; set {role}_MODEL or pass model=")
        return ChatOpenAI(model=resolved, base_url=_PROVIDER_BASE[provider], api_key=api_key, **kwargs)

    if provider == "openai_compatible":
        secret = provider_secret(provider)
        base_url = secret.get("base_url")
        if not base_url:
            raise RuntimeError(
                "openai_compatible needs a base_url. Add it in the dashboard (Build your stack) or set "
                "OPENAI_COMPAT_BASE_URL in .env."
            )
        resolved = _resolve_model(role, model, {})
        if not resolved:
            raise RuntimeError(f"no model for role {role!r}; set {role}_MODEL or pass model=")
        # Some self-hosted servers ignore the key; default to a placeholder so the client still builds.
        return ChatOpenAI(model=resolved, base_url=base_url, api_key=secret.get("api_key") or "sk-local", **kwargs)

    raise RuntimeError(f"unknown LLM_PROVIDER {provider!r}; use one of {', '.join(PROVIDERS)}")
