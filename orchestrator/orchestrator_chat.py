"""Conversational orchestrator for the Build workspace.

A thin LLM layer in FRONT of the existing conductor: it takes the user's plain-language chat message,
replies conversationally, and normalizes the request into a build spec (description + project type) that
the existing runner/conductor then drive through Band. It does NOT replace the conductor or the four
agents; it is the human-facing voice that kicks off and narrates the build.

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
    "or a static HTML/CSS/JS page). You are the friendly human-facing driver. Given the user's request, "
    "reply in ONE or TWO short sentences confirming what you will have the team build, then the team "
    "starts working. Keep scope small and self-contained; never promise a full-stack app, a server, a "
    "database, or third-party packages.\n\n"
    "Respond with ONLY a JSON object, no prose around it:\n"
    '{"reply": "<your 1-2 sentence reply to the user>", '
    '"description": "<a clear, normalized build request for the team>", '
    '"project_type": "python" | "static" | "auto"}'
)

_JSON = re.compile(r"\{.*\}", re.DOTALL)


def _fallback(message: str, project_type: str) -> dict:
    msg = " ".join((message or "").split())
    short = msg if len(msg) <= 120 else msg[:117] + "..."
    return {
        "reply": f"On it. I'll have the team build that now: {short}",
        "description": msg,
        "project_type": project_type if project_type in ("python", "static", "auto") else "auto",
    }


def interpret(message: str, project_type: str = "auto") -> dict:
    """Return {reply, description, project_type} for a user build message. Robust: any model/parse
    failure yields a templated reply with the user's message as the description."""
    message = (message or "").strip()
    if not message:
        return {"reply": "Tell me what to build and I'll get the team started.", "description": "", "project_type": "auto"}
    try:
        llm = make_llm("conductor", temperature=0.3, max_tokens=400)
        out = llm.invoke([("system", _SYSTEM), ("user", message)])
        text = out.content if isinstance(out.content, str) else str(out.content)
        m = _JSON.search(text)
        data = json.loads(m.group(0)) if m else {}
        reply = (data.get("reply") or "").strip()
        description = (data.get("description") or "").strip() or message
        ptype = (data.get("project_type") or project_type or "auto").lower()
        if ptype not in ("python", "static", "auto"):
            ptype = "auto"
        # The user may have explicitly chosen a type in the UI; honor it over the model's guess.
        if project_type in ("python", "static"):
            ptype = project_type
        if not reply:
            return _fallback(message, project_type)
        return {"reply": reply, "description": description, "project_type": ptype}
    except Exception as e:  # noqa: BLE001 - the build must start even if the orchestrator LLM is down
        logging.info("[orchestrator] interpret fell back (%s)", e)
        return _fallback(message, project_type)
