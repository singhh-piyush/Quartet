"""Shared setup for the four Band remote agents.

Each agent is its own long-running process. The role-specific files stay thin: they call
run_agent(name) (the Repairer also passes its run_tests tool). The model is resolved per role
inside make_llm based on LLM_PROVIDER.
"""

import asyncio
import logging
import time
from pathlib import Path

from band import Agent, AgentConfig, SessionConfig
from band.adapters import LangGraphAdapter
from langchain_core.callbacks import BaseCallbackHandler
from langgraph.checkpoint.memory import InMemorySaver

from bench.events import emit
from orchestrator.config import get_agent, make_llm

_PROMPTS = Path(__file__).resolve().parent.parent / "prompts"

# Cap agent generations: temperature 0 keeps handoff lines and @mentions stable, and a token ceiling
# stops a default-temp small model from running away mid-message (which reads as a loop stall).
_AGENT_TEMPERATURE = 0
_AGENT_MAX_TOKENS = 2048

# The conductor opens a fresh room per problem and adds the agents after they have connected. An
# agent auto-joins on the room-added push, but if that push is missed (the problem is posted before
# the join lands) the SDK recovers by re-polling /next every idle_resync_seconds. The 60s default is
# slower than our per-problem patience, so shorten it: a missed @Spec then wakes within this window.
_AGENT_IDLE_RESYNC = 15.0


class _TokenCallback(BaseCallbackHandler):
    """Emit one llm_call event per LLM round, with token usage and wall duration."""

    def __init__(self, role: str):
        self._role = role
        self._starts: dict = {}

    def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
        self._starts[run_id] = time.monotonic()

    def on_llm_end(self, response, *, run_id, **kwargs):
        start = self._starts.pop(run_id, None)
        duration_ms = int((time.monotonic() - start) * 1000) if start is not None else 0
        out = response.llm_output or {}
        usage = (out.get("token_usage") or out.get("usage") or {}) if isinstance(out, dict) else {}
        model = (out.get("model_name") or out.get("model") or "") if isinstance(out, dict) else ""
        pt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
        ct = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
        tt = int(usage.get("total_tokens") or (pt + ct))
        if tt == 0:  # local servers sometimes omit llm_output usage; try the message metadata
            try:
                um = response.generations[0][0].message.usage_metadata or {}
                pt = pt or int(um.get("input_tokens", 0))
                ct = ct or int(um.get("output_tokens", 0))
                tt = int(um.get("total_tokens", pt + ct))
            except Exception:
                pass
        emit(
            "llm_call", role=self._role, model=model,
            prompt_tokens=pt, completion_tokens=ct, total_tokens=tt, duration_ms=duration_ms,
        )


class _TelemetryAdapter(LangGraphAdapter):
    """LangGraphAdapter that emits agent_connected and message_received around the base behavior.

    The agent's outbound message is sent via `tools` inside on_message (not returned), so posts are
    recorded by the conductor from its room view; here we capture connect + inbound only.
    """

    def __init__(self, *args, role: str, **kwargs):
        self._role = role
        super().__init__(*args, **kwargs)

    async def on_started(self, agent_name, agent_description):
        emit("agent_connected", role=self._role)
        return await super().on_started(agent_name, agent_description)

    async def on_message(self, msg, tools, history, participants_msg, contacts_msg, *, is_session_bootstrap, room_id):
        emit(
            "message_received", role=self._role, room_id=room_id,
            sender=msg.sender_name or msg.sender_id, preview=msg.content,
        )
        return await super().on_message(
            msg, tools, history, participants_msg, contacts_msg,
            is_session_bootstrap=is_session_bootstrap, room_id=room_id,
        )


async def _serve(name: str, tools=None) -> None:
    cfg = get_agent(name)
    adapter = _TelemetryAdapter(
        role=name,
        llm=make_llm(name, temperature=_AGENT_TEMPERATURE, max_tokens=_AGENT_MAX_TOKENS, callbacks=[_TokenCallback(name)]),
        checkpointer=InMemorySaver(),
        custom_section=(_PROMPTS / f"{name}.md").read_text(),
        additional_tools=list(tools) if tools else None,
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=cfg["agent_id"],
        api_key=cfg["api_key"],
        # Only handle rooms we are newly added to (per-problem rooms arrive via RoomAddedEvent).
        # Without this the agent re-subscribes to every pre-existing room on startup and re-runs
        # their unfinished @mentions, flooding the shared model and starving the current problem.
        config=AgentConfig(auto_subscribe_existing_rooms=False),
        session_config=SessionConfig(idle_resync_seconds=_AGENT_IDLE_RESYNC),
    )
    logging.info("[%s] connected. Waiting for room messages...", name)
    await agent.run()


def run_agent(name: str, tools=None) -> None:
    """Start the named agent and run until interrupted."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(_serve(name, tools))
    except KeyboardInterrupt:
        logging.info("[%s] shutting down.", name)
