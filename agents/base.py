"""Shared setup for the four Band remote agents.

Each agent is its own long-running process. The role-specific files stay thin: they call
run_agent(name) (the Repairer also passes its run_tests tool). The model is resolved per role
inside make_llm based on LLM_PROVIDER.
"""

import asyncio
import logging
import os
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

# Room subscription: the SDK only subscribes to a per-problem room when the RoomAddedEvent push
# lands, and an agent that misses that push never creates an execution context, so idle_resync (which
# only re-polls /next for already-joined rooms) cannot recover it. With auto_subscribe_existing_rooms
# the agent instead lists the rooms it already belongs to at startup and subscribes deterministically.
# The demo launcher creates the room and adds the agents BEFORE starting them, then sets
# QUARTET_AUTO_SUBSCRIBE=1 so each fresh agent joins reliably with no push race. The benchmark CLI
# leaves it off (0) so a long-lived agent does not re-run every old room's pending mentions at start.
_AUTO_SUBSCRIBE = os.environ.get("QUARTET_AUTO_SUBSCRIBE", "0") == "1"

# With auto-subscribe on, a fresh agent also subscribes to every OTHER room it still belongs to and
# would act on any stale @mention left in those rooms, polluting the current run's event stream.
# QUARTET_ROOM_ID pins the agent to the one room the launcher created for this run; messages from any
# other room are ignored (not run through the model, not posted).
_TARGET_ROOM = os.environ.get("QUARTET_ROOM_ID") or None


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
        self._joined_rooms: set[str] = set()
        super().__init__(*args, **kwargs)

    async def on_started(self, agent_name, agent_description):
        emit("agent_connected", role=self._role)
        return await super().on_started(agent_name, agent_description)

    async def on_message(self, msg, tools, history, participants_msg, contacts_msg, *, is_session_bootstrap, room_id):
        # Ignore any room other than the one this run is pinned to (see _TARGET_ROOM). A fresh
        # auto-subscribed agent would otherwise pick up stale @mentions from old rooms and emit
        # events into this run's stream. Returning before super() means no model call and no post.
        if _TARGET_ROOM and room_id and room_id != _TARGET_ROOM:
            return None
        # First message we handle for a room means the agent subscribed and woke. Emit a join signal
        # so the stream proves the handoff reached this agent (the hop-1 stall showed up as the
        # non-Spec agents never emitting this).
        if room_id and room_id not in self._joined_rooms:
            self._joined_rooms.add(room_id)
            emit("room_joined", role=self._role, room_id=room_id)
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
        # Per-problem rooms normally arrive via RoomAddedEvent. When the demo launcher pre-creates
        # the room and adds the agent before starting it, QUARTET_AUTO_SUBSCRIBE=1 makes the agent
        # subscribe to rooms it already belongs to at startup, joining deterministically with no push
        # race. Off (the benchmark default) it would re-run every pre-existing room's pending
        # @mentions on start, flooding the shared model and starving the current problem.
        config=AgentConfig(auto_subscribe_existing_rooms=_AUTO_SUBSCRIBE),
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
