"""Named "agent stacks": saved model selections you can list, load, save, and duplicate.

A stack is just a run_config payload ({name, agents:{role:{provider,model}}, large:{provider,model}})
with a name, stored one-per-file at results/stacks/<name>.json. Stacks hold model NAMES and providers
only, never API keys (those live in orchestrator/provider_keys.json, gitignored). Loading a stack writes
it to the active run_config.json via run_config.save(), so orchestrator.runner reads it unchanged.

This module reuses run_config's shape helpers (_merge / defaults / save) so a stack always has the same
stable shape the launcher expects, even if a saved file is partial.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from orchestrator import run_config

STACKS_DIR = Path(__file__).resolve().parent.parent / "results" / "stacks"
_NAME_OK = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_name(name: str) -> str:
    """Slug a user-supplied stack name to a filesystem-safe token (no traversal). Raises on empty."""
    slug = _NAME_OK.sub("-", (name or "").strip()).strip("-.")
    if not slug:
        raise ValueError("stack name is empty after sanitizing")
    return slug


def _path(name: str) -> Path:
    return STACKS_DIR / f"{_safe_name(name)}.json"


def _providers(cfg: dict) -> list[str]:
    used = {a.get("provider") for a in cfg.get("agents", {}).values()}
    used.add(cfg.get("large", {}).get("provider"))
    return sorted(p for p in used if p)


def list_stacks() -> list[dict]:
    """Every saved stack as {name, mtime, providers}, newest first. Never includes any key."""
    out: list[dict] = []
    if not STACKS_DIR.exists():
        return out
    for p in STACKS_DIR.glob("*.json"):
        try:
            cfg = json.loads(p.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        out.append({"name": cfg.get("name") or p.stem, "mtime": p.stat().st_mtime, "providers": _providers(cfg)})
    out.sort(key=lambda s: -s["mtime"])
    return out


def load_stack(name: str) -> dict:
    """Read a stack merged over run_config defaults (so a partial file still has stable shape)."""
    cfg = json.loads(_path(name).read_text())
    merged = run_config._merge(run_config.defaults(), cfg)
    merged["name"] = cfg.get("name") or _safe_name(name)
    return merged


def save_stack(name: str, cfg: dict) -> dict:
    """Persist a (possibly partial) stack under `name`. Strips to provider/model slots via _merge, so
    no key can ever land in the file. Returns the stored result."""
    STACKS_DIR.mkdir(parents=True, exist_ok=True)
    merged = run_config._merge(run_config.defaults(), cfg or {})
    merged["name"] = _safe_name(name)
    _path(name).write_text(json.dumps(merged, indent=2))
    return merged


def duplicate_stack(name: str, new_name: str) -> dict:
    """Copy an existing stack to a new name and return the copy."""
    return save_stack(new_name, load_stack(name))


def activate_stack(name: str) -> dict:
    """Load a stack and make it the active run config (write run_config.json). Returns the active cfg."""
    return run_config.save(load_stack(name))


def delete_stack(name: str) -> None:
    """Remove a saved stack file if present (no error if already gone)."""
    _path(name).unlink(missing_ok=True)
