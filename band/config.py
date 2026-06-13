"""Config loader and Featherless client helper."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

load_dotenv()

_CONFIG_PATH = Path(__file__).parent.parent / "agent_config.yaml"

FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1"


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


def featherless_client(model: str, **kwargs) -> ChatOpenAI:
    """Build a ChatOpenAI client pointed at Featherless for the given model string."""
    api_key = os.environ.get("FEATHERLESS_API_KEY")
    if not api_key:
        raise RuntimeError("FEATHERLESS_API_KEY not set in environment")
    return ChatOpenAI(
        model=model,
        base_url=FEATHERLESS_BASE_URL,
        api_key=api_key,
        **kwargs,
    )
