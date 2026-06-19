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

from orchestrator import keystore

load_dotenv()

_CONFIG_PATH = Path(__file__).parent.parent / "agent_config.yaml"

# Cloud-provider inference keys (groq / aimlapi / openai_compatible) entered from the dashboard live in
# the in-memory keystore (orchestrator/keystore.py): never on disk, never logged, never returned. In a
# spawned agent process the keystore is empty, but the runner injects the same secrets as env vars
# (GROQ_API_KEY / AIML_API_KEY / OPENAI_COMPAT_*), which provider_secret() reads first.

# Local OpenAI-compatible endpoints. Two servers in the default topology: the four agents run a small
# coder model on :8081, the large competitor runs Qwen3.6 on :8080. make_llm uses LOCAL_BASE_URL, which
# the launcher sets per process (agents -> LOCAL_AGENTS_URL, large -> LOCAL_LARGE_URL) so each hits its
# own server. The default keeps :8081 for back-compat when nothing sets it.
LOCAL_BASE_URL = os.environ.get("LOCAL_BASE_URL", "http://localhost:8081/v1")
LOCAL_LARGE_URL = os.environ.get("LOCAL_LARGE_URL", "http://localhost:8080/v1")
LOCAL_AGENTS_URL = os.environ.get("LOCAL_AGENTS_URL", "http://localhost:8081/v1")
AIMLAPI_BASE_URL = "https://api.aimlapi.com/v1"
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
# Gemini's OpenAI-compatible layer (chat/completions, models) and OpenRouter, both OpenAI-shaped.
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# The cloud providers selectable from the dashboard, with their fixed OpenAI-compatible base. local has
# no fixed base (per-process LOCAL_BASE_URL) and openai_compatible carries a user base in the key store.
PROVIDERS = ("local", "groq", "aimlapi", "gemini", "openrouter", "openai_compatible")
_PROVIDER_BASE = {
    "groq": GROQ_BASE_URL,
    "aimlapi": AIMLAPI_BASE_URL,
    "gemini": GEMINI_BASE_URL,
    "openrouter": OPENROUTER_BASE_URL,
}
# Keyed providers with a fixed base whose key resolves env-first then the dashboard store (same shape).
_FIXED_KEYED = {
    "groq": "GROQ_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}

# Server-side SHARED default keys: a deploy can set these so a judge can run with no key of their own
# (rate-limited). Resolved AFTER the provider env var and the in-memory BYO store, so a user's own key
# always overrides the shared one. Set only the QUARTET_DEFAULT_* var on a deploy (not GROQ_API_KEY),
# so the session BYO key wins. The value is never logged or returned to the client.
_DEFAULT_KEY_ENV = {
    "groq": "QUARTET_DEFAULT_GROQ_KEY",
}

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

# Per-role default models on Gemini and OpenRouter (seeds only; the dashboard dropdown pulls the live
# /models list at runtime). Verify ids against the provider before relying on them.
_GEMINI_DEFAULTS = {
    "spec": "gemini-2.5-flash-lite",
    "coder": "gemini-2.5-flash",
    "tester": "gemini-2.5-flash-lite",
    "repairer": "gemini-2.5-flash",
}
_OPENROUTER_DEFAULTS = {
    "spec": "openai/gpt-oss-20b",
    "coder": "openai/gpt-oss-120b",
    "tester": "meta-llama/llama-3.3-70b-instruct",
    "repairer": "openai/gpt-oss-120b",
}

# Per-role default seeds by provider, used by make_llm and run_config when nothing is selected.
_PROVIDER_DEFAULTS = {
    "aimlapi": _AIML_DEFAULTS,
    "groq": _GROQ_DEFAULTS,
    "gemini": _GEMINI_DEFAULTS,
    "openrouter": _OPENROUTER_DEFAULTS,
}

# Local OpenAI-compatible server (llama.cpp / vLLM); the model name is usually ignored.
LOCAL_MODEL = os.environ.get("LOCAL_MODEL", "local-model")


@lru_cache(maxsize=1)
def _load_config() -> dict:
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _read_provider_keys() -> dict:
    """The in-memory provider key store (orchestrator/keystore.py). In the demo-server process this
    holds keys entered from the dashboard; in a spawned agent process it is empty (the runner injects
    those secrets via env instead, which provider_secret reads first). Never touches disk."""
    return keystore.all_keys()


def aimlapi_key() -> str | None:
    """The aimlapi inference key. Looked up in order: AIML_API_KEY env / .env, then the in-memory key
    store, then agent_config.yaml so a key can also live in one file if preferred. Accepts a top-level
    `aiml_api_key:` or a nested `providers: {aimlapi: {api_key: ...}}`. This is the LLM key, distinct
    from the per-agent `band_*` keys (which authenticate the Band chat room, not model inference)."""
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
    """Store a provider's secret in the in-memory keystore (no disk). Used by the dashboard. Returns
    key_status() (booleans only, never the key)."""
    keystore.set_key(provider, api_key, base_url)
    return key_status()


def _key_is_shared(provider: str) -> bool:
    """True when the only key available for this provider is the server's shared default (no provider
    env var, no BYO key in the store). Lets the UI label runs as using the rate-limited shared key and
    invite the user to add their own. Never exposes the key itself."""
    default_var = _DEFAULT_KEY_ENV.get(provider)
    if not default_var or not os.environ.get(default_var):
        return False
    store = _read_provider_keys().get(provider) or {}
    env_var = _FIXED_KEYED.get(provider)
    has_own = bool((env_var and os.environ.get(env_var)) or store.get("api_key"))
    return not has_own


def key_status() -> dict:
    """Which providers have a usable secret, plus the non-secret openai_compatible base_url. `shared` is
    true when the only key is the server's shared default (no BYO/env key). Never includes a key value,
    so it is safe to return to the client."""
    oc = provider_secret("openai_compatible")
    status = {
        p: {"has_key": bool(provider_secret(p).get("api_key")), "shared": _key_is_shared(p)}
        for p in ("groq", "aimlapi", "gemini", "openrouter")
    }
    status["openai_compatible"] = {
        "has_key": bool(oc.get("api_key")),
        "shared": False,
        "base_url": oc.get("base_url") or "",
    }
    return status


def provider_secret(provider: str) -> dict:
    """Resolve {base_url?, api_key?} for a cloud provider from the environment first, then the
    dashboard key store. Never raises; missing values are simply absent so callers give a clear error.

      groq / gemini / openrouter -> {api_key} from the provider's env var, then the store
      aimlapi            -> {api_key} via aimlapi_key() (env / store / agent_config.yaml)
      openai_compatible  -> {base_url, api_key} from OPENAI_COMPAT_* env / store
      local              -> {} (uses the per-process LOCAL_BASE_URL, no key)
    """
    store = _read_provider_keys().get(provider) or {}
    if provider == "aimlapi":
        key = aimlapi_key()
        return {"api_key": key} if key else {}
    if provider in _FIXED_KEYED:
        # provider env var -> BYO store -> server shared default (so a user's own key always wins).
        default_var = _DEFAULT_KEY_ENV.get(provider)
        key = (
            os.environ.get(_FIXED_KEYED[provider])
            or store.get("api_key")
            or (os.environ.get(default_var) if default_var else None)
        )
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

    if provider in _PROVIDER_BASE:  # aimlapi / groq / gemini / openrouter: fixed base + key + per-role model
        secret = provider_secret(provider)
        api_key = secret.get("api_key")
        if not api_key:
            env_var = "AIML_API_KEY" if provider == "aimlapi" else _FIXED_KEYED.get(provider, f"{provider.upper()}_API_KEY")
            raise RuntimeError(
                f"no {provider} key found. Add it in the dashboard (Build your stack) or set "
                f"{env_var} in .env. Note: this is an inference key, not a band_ chat key."
            )
        resolved = _resolve_model(role, model, _PROVIDER_DEFAULTS.get(provider, {}))
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
