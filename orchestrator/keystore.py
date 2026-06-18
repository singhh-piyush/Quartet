"""In-memory provider key store for the demo server process.

Provider inference keys (groq / aimlapi / openai_compatible) entered from the dashboard are held HERE,
in process memory only: never written to disk, never logged, never returned to the client. They live
for the lifetime of the demo-server process and are gone on restart. The runner injects them into the
spawned agent processes via environment variables at launch (orchestrator/runner.py), so the child
processes resolve them without any file or shared state.

This deliberately replaces the earlier on-disk orchestrator/provider_keys.json store: the build
workspace is reachable over a public tunnel, so a key must never touch disk.
"""

from __future__ import annotations

import threading

_LOCK = threading.Lock()
# provider -> {"api_key": str, "base_url": str}. Only the providers that take a key appear here.
_KEYS: dict[str, dict] = {}

KEYED_PROVIDERS = ("groq", "aimlapi", "gemini", "openrouter", "openai_compatible")


def set_key(provider: str, api_key: str | None = None, base_url: str | None = None) -> None:
    """Store/merge a provider's secret in memory. Empty values are ignored (keep what is there)."""
    if provider not in KEYED_PROVIDERS:
        raise ValueError(f"provider {provider!r} does not take a key")
    with _LOCK:
        entry = dict(_KEYS.get(provider) or {})
        if api_key and api_key.strip():
            entry["api_key"] = api_key.strip()
        if base_url and base_url.strip():
            entry["base_url"] = base_url.strip()
        _KEYS[provider] = entry


def get(provider: str) -> dict:
    """The in-memory secret for a provider ({} when none). A copy, so callers cannot mutate the store."""
    with _LOCK:
        return dict(_KEYS.get(provider) or {})


def all_keys() -> dict:
    """A snapshot of every stored secret (provider -> {api_key?, base_url?}). For env injection only;
    never serialize this to a response."""
    with _LOCK:
        return {p: dict(v) for p, v in _KEYS.items()}


def clear() -> None:
    with _LOCK:
        _KEYS.clear()
