"""Conversational orchestrator for the Build workspace.

A thin LLM layer in FRONT of the existing conductor: it takes the user's plain-language chat message,
replies conversationally, and normalizes the request into a build spec (description + project type) that
the existing runner/conductor then drive through Band. It does NOT replace the conductor or the four
agents; it is the human-facing voice that kicks off and narrates the build.

It is STATEFUL: each call receives the prior conversation so follow-up messages refine the SAME build
request instead of being read in isolation. It is also ROLE-DISCIPLINED: it never answers the user's
topic itself (a topic like "why fish live in water" is the SUBJECT of the page to build, not a question
for the Orchestrator to answer).

Never raises: every model failure falls back to a sensible templated reply so the build still starts.
"""

from __future__ import annotations

import json
import logging
import re

from orchestrator.config import make_llm

_SYSTEM = (
    "You are the Orchestrator of Quartet: four small models (Spec, Coder, Tester, Repairer) that "
    "collaborate through Band to build small, self-contained projects (a short Python script/module, "
    "or a static HTML/CSS/JS page).\n\n"
    "Your ONLY job is to turn the conversation into a clear BUILD SPEC for the team. You are NOT a "
    "general assistant. You NEVER answer the user's question or explain the topic yourself. If the user "
    "gives a topic (for example 'why fish live in water'), that topic is the SUBJECT of the page to "
    "build, not a question for you to answer. If the user adds detail in a follow-up (for example 'also "
    "mention why some fish live in salt water and some in fresh'), MERGE it into the build request you "
    "are accumulating across the whole conversation. Do not ask the user to clarify unless the request "
    "is truly unintelligible; prefer to make a sensible assumption and build.\n\n"
    "Keep scope small and self-contained: never a full-stack app, a server, a database, or third-party "
    "packages.\n\n"
    "Reply in ONE short, friendly sentence that confirms what the team will build (for example: "
    "\"Got it - I'll have the team build a static page explaining why fish live in water, including why "
    "some live in salt water and some in fresh.\"). Build-framed only; never answer the topic. After your "
    "reply the user clicks Confirm to start the build.\n\n"
    "Respond with ONLY a JSON object, no prose around it:\n"
    '{"reply": "<one friendly, build-framed sentence; never answer the topic>", '
    '"description": "<the full normalized build request, merging ALL of the user\'s messages so far>", '
    '"project_type": "python" | "static" | "auto"}'
)

_JSON = re.compile(r"\{.*\}", re.DOTALL)

# Only the most recent turns are needed for context; cap so a long chat does not bloat the prompt.
_MAX_HISTORY = 8


def _fallback(message: str, project_type: str, history: list | None = None) -> dict:
    # Merge prior user turns with the new message so a refinement still builds the whole thing.
    prior = " ".join(
        (h.get("content") or "").strip()
        for h in (history or [])
        if (h.get("role") or "").lower() == "user"
    )
    full = " ".join(f"{prior} {message}".split())
    short = full if len(full) <= 120 else full[:117] + "..."
    return {
        "reply": f"Got it - I'll have the team build that now: {short}",
        "description": full or message,
        "project_type": project_type if project_type in ("python", "static", "auto") else "auto",
    }


def _history_messages(history: list | None) -> list[tuple[str, str]]:
    """Map prior transcript turns to chat messages: user -> user, orchestrator -> assistant. Other
    roles (the four agents) are not part of the planning dialogue and are skipped."""
    out: list[tuple[str, str]] = []
    for h in (history or [])[-_MAX_HISTORY:]:
        role = (h.get("role") or "").lower()
        content = (h.get("content") or "").strip()
        if not content:
            continue
        if role == "user":
            out.append(("user", content))
        elif role == "orchestrator":
            out.append(("assistant", content))
    return out


def interpret(message: str, project_type: str = "auto", history: list | None = None) -> dict:
    """Return {reply, description, project_type} for a user build message, in the context of the prior
    conversation (history: a list of {role, content} turns). Robust: any model/parse failure yields a
    templated reply that merges the conversation into the description."""
    message = (message or "").strip()
    if not message:
        return {"reply": "Tell me what to build and I'll get the team started.", "description": "", "project_type": "auto"}
    try:
        llm = make_llm("conductor", temperature=0.3, max_tokens=500)
        msgs = [("system", _SYSTEM), *_history_messages(history), ("user", message)]
        out = llm.invoke(msgs)
        text = out.content if isinstance(out.content, str) else str(out.content)
        m = _JSON.search(text)
        data = json.loads(m.group(0)) if m else {}
        reply = (data.get("reply") or "").strip()
        description = (data.get("description") or "").strip()
        ptype = (data.get("project_type") or project_type or "auto").lower()
        if ptype not in ("python", "static", "auto"):
            ptype = "auto"
        # The user may have explicitly chosen a type in the UI; honor it over the model's guess.
        if project_type in ("python", "static"):
            ptype = project_type
        if not reply or not description:
            return _fallback(message, project_type, history)
        return {"reply": reply, "description": description, "project_type": ptype}
    except Exception as e:  # noqa: BLE001 - the build must start even if the orchestrator LLM is down
        logging.info("[orchestrator] interpret fell back (%s)", e)
        return _fallback(message, project_type, history)
