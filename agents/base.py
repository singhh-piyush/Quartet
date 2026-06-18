"""Shared setup for the four Band remote agents.

Each agent is its own long-running process. The role-specific files stay thin: they call
run_agent(name) (the Repairer also passes its run_tests tool). The model is resolved per role
inside make_llm based on LLM_PROVIDER.
"""

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
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
_AGENT_MAX_TOKENS = 3072

# The local model is a reasoning-distilled build (--reasoning-format deepseek). Left to think, its
# chain-of-thought alone exceeds the token budget, so the turn ends (finish=length) with the actual
# answer never produced and nothing to hand off - the loop stalls. Disabling thinking via the chat
# template makes each agent emit its answer (spec / code / tests / diagnosis) directly: capturable,
# postable, and fast. Only applied to the local provider (the chat-template kwarg is llama.cpp/Qwen).
_NO_THINK_BODY = {"extra_body": {"chat_template_kwargs": {"enable_thinking": False}}}

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

# Auto-post fallback. The Band loop only advances when an agent calls the band_send_message tool to
# post its handoff. Smaller / reasoning-distilled local models often return a plain final answer (with
# an @Role line) WITHOUT emitting that tool call, so nothing reaches the room and the loop stalls at
# hop 1. When that happens we post the model's final answer ourselves, routed to the next role, so the
# chain proceeds. If the model DID call band_send_message, we leave it alone (no double-post).
_SEND_TOOL = "band_send_message"
_MENTION_RE = re.compile(r"@([A-Za-z][A-Za-z0-9_-]*)")
# Default next hop per role when the model's text named no @Role (Repairer ends at the Conductor).
_HANDOFF = {"spec": "Coder", "coder": "Tester", "tester": "Repairer", "repairer": "Conductor"}


def _ai_text(out) -> str:
    """Extract plain text from a LangChain AIMessage(/chunk) content, ignoring non-text parts."""
    content = getattr(out, "content", out)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if isinstance(c, str):
                parts.append(c)
            elif isinstance(c, dict) and c.get("type") == "text":
                parts.append(c.get("text", ""))
        return "".join(parts)
    return ""


# The Band agent API is inbox-scoped: the conductor only sees messages that mention it, never the
# Spec->Coder->Tester handoffs. So each agent records its own full posted message (no 200-char cap,
# local artifact, no keys) to results/transcripts/<run_id>.messages.jsonl; the demo server merges
# these into the reasoning transcript. Append mode keeps the four agent processes from clobbering.
_TRANSCRIPTS = Path(__file__).resolve().parent.parent / "results" / "transcripts"
_FINAL_RE = re.compile(r"^[ \t]*FINAL_SOLUTION\b", re.MULTILINE)
_NONE_RE = re.compile(r"^[ \t]*NO_SOLUTION\b", re.MULTILINE)


def _kind(content: str) -> str | None:
    if _FINAL_RE.search(content):
        return "FINAL_SOLUTION"
    if _NONE_RE.search(content):
        return "NO_SOLUTION"
    return None


def _record_message(role: str, content: str, mentions: list) -> None:
    """Append this agent's full posted message to the per-run transcript log."""
    run_id = os.environ.get("QUARTET_RUN_ID")
    if not run_id or not content:
        return
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "role": role,
        "sender": role.capitalize(),
        "content": content,
        "mentions": [str(m) for m in (mentions or [])],
        "kind": _kind(content),
    }
    try:
        _TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
        with open(_TRANSCRIPTS / f"{run_id}.messages.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec) + "\n")
    except Exception:  # noqa: BLE001 - transcript logging must never break the agent
        pass


def _resolve_targets(tools, wanted: list[str]) -> list[str]:
    """Map @Role names to actual participant handles/names in the room (case-insensitive), so
    tools.send_message can resolve them. Returns the strings to pass as mentions."""
    parts = getattr(tools, "_participants", None) or []
    out: list[str] = []
    for w in wanted:
        wl = w.lstrip("@").lower()
        for p in parts:
            name = (p.get("name") or "")
            handle = (p.get("handle") or "").lstrip("@")
            if wl in (name.lower(), handle.lower()) or name.lower().startswith(wl):
                out.append(handle or name)
                break
    return out


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
        self._turn_posted: dict[str, bool] = {}   # room_id -> did band_send_message fire this turn
        self._turn_content: dict[str, str] = {}    # room_id -> model's final answer this turn
        self._turn_stream: dict[str, str] = {}     # room_id -> accumulated streamed answer text
        self._sent_content: dict[str, str] = {}    # room_id -> band_send_message content (if called)
        self._sent_mentions: dict[str, list] = {}  # room_id -> band_send_message mentions (if called)
        super().__init__(*args, **kwargs)

    async def on_started(self, agent_name, agent_description):
        emit("agent_connected", role=self._role)
        return await super().on_started(agent_name, agent_description)

    async def _handle_stream_event(self, event, room_id, tools):
        # Preserve the base behaviour (forwards tool_call/tool_result/error events), then track whether
        # the agent actually posted, and capture the model's final plain-text answer for the fallback.
        await super()._handle_stream_event(event, room_id, tools)
        etype = event.get("event")
        if etype == "on_tool_start" and event.get("name") == _SEND_TOOL:
            self._turn_posted[room_id] = True
            inp = (event.get("data") or {}).get("input")
            if isinstance(inp, dict):  # capture what the model posted for the transcript
                self._sent_content[room_id] = inp.get("content") or ""
                self._sent_mentions[room_id] = inp.get("mentions") or []
        elif etype == "on_chat_model_stream":
            # Accumulate the streamed answer; on some servers on_chat_model_end output.content is empty
            # (e.g. reasoning-format models), so the stream is the reliable source of the final text.
            t = _ai_text((event.get("data") or {}).get("chunk"))
            if t:
                self._turn_stream[room_id] = self._turn_stream.get(room_id, "") + t
        elif etype == "on_chat_model_end":
            out = (event.get("data") or {}).get("output")
            tcs = [getattr(tc, "get", lambda *_: None)("name") if isinstance(tc, dict) else getattr(tc, "name", "?")
                   for tc in (getattr(out, "tool_calls", None) or [])]
            logging.info("[%s] chat_model_end: end_content=%d stream=%d tool_calls=%s finish=%s",
                         self._role, len(_ai_text(out)), len(self._turn_stream.get(room_id, "")), tcs,
                         (getattr(out, "response_metadata", {}) or {}).get("finish_reason"))
            # latest model answer this turn, regardless of any stray tool call; fall back to the stream
            text = _ai_text(out) or self._turn_stream.get(room_id, "")
            if text:
                self._turn_content[room_id] = text

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
        self._turn_posted[room_id] = False
        self._turn_content[room_id] = ""
        self._turn_stream[room_id] = ""
        self._sent_content[room_id] = ""
        self._sent_mentions[room_id] = []
        result = await super().on_message(
            msg, tools, history, participants_msg, contacts_msg,
            is_session_bootstrap=is_session_bootstrap, room_id=room_id,
        )
        if self._turn_posted.get(room_id):
            # The model called band_send_message itself; record what it posted for the transcript and
            # emit the posted event (the inbox-scoped conductor cannot see this to emit it).
            c = self._sent_content.get(room_id, "")
            m = [str(x) for x in (self._sent_mentions.get(room_id) or [])]
            _record_message(self._role, c, m)
            if c:
                emit("message_posted", role=self._role, room_id=room_id, preview=c, mentions=m)
        else:
            # Fallback: the model gave a final answer but never called band_send_message, so the loop
            # would stall. Post that answer ourselves, routed to whoever the text @mentions, else next.
            content = self._turn_content.get(room_id, "").strip()
            if not content:
                logging.info("[%s] model neither called %s nor produced final text to auto-post", self._role, _SEND_TOOL)
            else:
                named = _MENTION_RE.findall(content)
                mentions = _resolve_targets(tools, named)
                if not mentions:
                    nxt = _HANDOFF.get(self._role)
                    mentions = _resolve_targets(tools, [nxt]) if nxt else []
                    if mentions and not named:
                        content = f"@{nxt} {content}"  # surface the routing in the visible text too
                if mentions:
                    try:
                        await tools.send_message(content, mentions=mentions)
                        _record_message(self._role, content, named or mentions)
                        emit("message_posted", role=self._role, room_id=room_id, preview=content, mentions=named or mentions)
                        logging.info("[%s] auto-posted final answer (model skipped %s)", self._role, _SEND_TOOL)
                    except Exception as e:  # noqa: BLE001 - a failed fallback must not crash the agent
                        logging.warning("[%s] auto-post fallback failed: %s", self._role, e)
                else:
                    logging.warning("[%s] have text but could not resolve a handoff target; not posted", self._role)
        return result


async def _serve(name: str, tools=None) -> None:
    cfg = get_agent(name)
    no_think = _NO_THINK_BODY if os.environ.get("LLM_PROVIDER", "local") == "local" else {}
    adapter = _TelemetryAdapter(
        role=name,
        # stream_usage=True asks the server for a final usage chunk (stream_options.include_usage) so
        # the streamed agent response carries token counts; without it the agents report 0 tokens (only
        # the non-streaming baseline would have usage) and the cost comparison breaks.
        llm=make_llm(name, temperature=_AGENT_TEMPERATURE, max_tokens=_AGENT_MAX_TOKENS, callbacks=[_TokenCallback(name)], stream_usage=True, **no_think),
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
