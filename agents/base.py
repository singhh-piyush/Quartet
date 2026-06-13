"""Shared setup for the four Band remote agents.

Each agent is its own long-running process. The role-specific files stay thin: they call
run_agent(name) (the Repairer also passes its run_tests tool). The model is resolved per role
inside make_llm based on LLM_PROVIDER.
"""

import asyncio
import logging
from pathlib import Path

from band import Agent
from band.adapters import LangGraphAdapter
from langgraph.checkpoint.memory import InMemorySaver

from orchestrator.config import get_agent, make_llm

_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"


async def _serve(name: str, tools=None) -> None:
    cfg = get_agent(name)
    adapter = LangGraphAdapter(
        llm=make_llm(name),
        checkpointer=InMemorySaver(),
        custom_section=(_PROMPTS / f"{name}.md").read_text(),
        additional_tools=list(tools) if tools else None,
    )
    agent = Agent.create(adapter=adapter, agent_id=cfg["agent_id"], api_key=cfg["api_key"])
    logging.info("[%s] connected. Waiting for room messages...", name)
    await agent.run()


def run_agent(name: str, tools=None) -> None:
    """Start the named agent and run until interrupted."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(_serve(name, tools))
    except KeyboardInterrupt:
        logging.info("[%s] shutting down.", name)
