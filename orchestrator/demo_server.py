"""Thin read-only HTTP/SSE bridge for the judge-facing demo.

Streams the JSONL telemetry that the agents and conductor already write
(`results/events/<run_id>.jsonl`) over Server-Sent Events, and serves the normalized per-config
results the Results view charts. This module READS those files only; it never touches the agents,
the conductor, or any bench logic, and starts no model.

Stdlib only (http.server) for the data plane. The control plane (starting real runs, the model
selection) lives in orchestrator.runner / orchestrator.run_config; this module just exposes it.
Endpoints:
  GET  /api/runs                                  list recorded runs
  GET  /api/stream?run_id=&mode=replay|live&speed= SSE event stream
  GET  /api/results                               three-config Pass@1 + cost bars
  GET  /api/events?run_id=                         whole run as one ordered array (client replay)
  GET  /api/transcript?run_id=                     full agent reasoning (bodies) for the run
  GET  /api/models                                 per-agent + large model selection (names only)
  POST /api/models                                 save the model selection
  GET  /api/keys                                   which providers have a key (booleans, never values)
  POST /api/keys    {provider, api_key, base_url?} store a provider key server-side
  GET  /api/provider_models?provider=              list a provider's model ids (for the dropdowns)
  POST /api/validate {provider}                    check a provider is usable (reuses the preflight)
  GET  /api/stacks                                 list named agent stacks (no keys)
  POST /api/stacks  {name, config}                 save a named stack (Save As)
  POST /api/stacks/load {name}                     load a stack into the active config
  POST /api/stacks/duplicate {name, new_name}      copy a stack under a new name
  POST /api/lab/run {stack, n}                      benchmark one stack over n HumanEval problems
  GET  /api/lab/results                             persisted per-stack lab results (no keys)
  GET  /api/lab/pricing                             the editable per-model price table
  POST /api/lab/pricing {table | {model,input,output}}  update the price table
  GET  /api/agents                                 live run + agent process status
  POST /api/run     {task_id}                      start a real live Quartet run + large race
  POST /api/build   {description, project_type, stack?}  start a live BUILD run (multi-file project)
  GET  /api/project?run_id=                        the built project: type, file tree, README
  GET  /api/project/file?run_id=&path=             one project file's content
  GET  /api/project/zip?run_id=                    download the project as a .zip
  GET  /api/project/preview/<run_id>/<path>        serve a static project file for the iframe preview
  POST /api/stop                                   stop the active run
Anything else is served from the built frontend at web/dist/ (SPA fallback to index.html).
Process-spawning + key POSTs require localhost or the X-Quartet-Token shared token (tunnel access);
keys live in memory only and are never returned. CORS echoes QUARTET_ALLOWED_ORIGINS + localhost.

Cost note: cost_usd is derived from the editable per-model price table (bench.pricing,
results/lab/pricing.json) times the token counts in the results files. Local-provider runs frequently
report total_tokens=0 (the OpenAI-compatible server omits usage), so cost is only meaningful for hosted
providers (groq / gemini / openrouter / aimlapi) or the bundled sample.

Run: uv run python -m orchestrator.demo_server  [--host 127.0.0.1] [--port 8000]
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from bench import pricing
from bench.events import read_events
from orchestrator import run_config, stacks
from orchestrator.config import key_status, save_provider_key
from orchestrator.runner import RunManager, list_lab_results, list_provider_models, validate_provider

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
EVENTS_DIR = RESULTS / "events"
TRANSCRIPTS_DIR = RESULTS / "transcripts"
PROJECTS_DIR = RESULTS / "projects"
WEB_DIST = ROOT / "web" / "dist"
SAMPLE_RESULTS = RESULTS / "demo-results.sample.json"

# CORS allowlist for the deployed frontend (e.g. the Vercel origin). Comma-separated; localhost dev
# origins are always allowed. The control plane is additionally guarded by the token check below.
_ALLOWED_ORIGINS = {o.strip() for o in os.environ.get("QUARTET_ALLOWED_ORIGINS", "").split(",") if o.strip()}

# Single live run at a time, shared across handler threads.
RUNS = RunManager()

_RUN_ID_OK = re.compile(r"^[A-Za-z0-9._-]+$")  # guards the run_id -> filename mapping (no traversal)
_REPLAY_GAP_CAP = 2.0  # never sit on dead air longer than this between two replayed events
_LIVE_POLL = 0.3       # seconds between polls when tailing an active run

def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _origin_is_local(origin: str) -> bool:
    """True for a localhost dev origin (http://localhost:5173, http://127.0.0.1:8000, etc.)."""
    return bool(re.match(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$", origin or ""))


def _safe_join(base: Path, rel: str) -> Path | None:
    """Resolve base/rel and return it only if it stays inside base (no traversal, no absolute)."""
    rel = (rel or "").lstrip("/")
    if not rel:
        return None
    target = (base / rel).resolve()
    base = base.resolve()
    if base != target and base not in target.parents:
        return None
    return target


def _read_messages_jsonl(path: Path) -> list[dict]:
    """Read a per-run agent message log (full bodies the agents append, one JSON per line)."""
    out: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except FileNotFoundError:
        pass
    return out


# ---- /api/runs -------------------------------------------------------------------------------

def list_runs() -> list[dict]:
    runs = []
    for p in EVENTS_DIR.glob("*.jsonl"):
        events = read_events(str(p))
        run_id = p.stem
        task_id = next((e.get("task_id") for e in events if e.get("task_id")), None)
        runs.append({
            "run_id": run_id,
            "file": p.name,
            "mtime": p.stat().st_mtime,
            "events": len(events),
            "complete": any(e.get("type") == "scored" for e in events),
            "task_id": task_id,
            "kind": "demo" if run_id.startswith("demo") else "run",
        })
    # Pin the demo fixture first, then newest real runs.
    runs.sort(key=lambda r: (r["kind"] != "demo", -r["mtime"]))
    return runs


# ---- /api/results ----------------------------------------------------------------------------

def build_results() -> dict:
    """Normalize baselines + quartet into three comparable configs.

    Prefers a real results file only when it actually has passes; otherwise falls back to the bundled
    sample and tags the config source=sample so the UI can badge it as illustrative, never real.
    """
    sample = _read_json(SAMPLE_RESULTS) or {}
    baselines_real = _read_json(RESULTS / "baselines.json") or {}
    quartet_real = _read_json(RESULTS / "quartet_local.json") or {}

    def pick_baseline(key: str):
        real = baselines_real.get(key)
        if real and real.get("pass_count", 0) > 0:
            return real, "real"
        return sample.get("baselines", {}).get(key, {}), "sample"

    def pick_quartet():
        if quartet_real.get("pass_count", 0) > 0:
            return quartet_real, "real"
        return sample.get("quartet", {}), "sample"

    plan = [
        ("single_small", "Single small", pick_baseline("single_small")),
        ("quartet", "Quartet", pick_quartet()),
        ("single_large", "Single large", pick_baseline("single_large")),
    ]
    configs = []
    for key, label, (data, source) in plan:
        pass_count = int(data.get("pass_count", 0))
        total = int(data.get("total", 0))
        pass_rate = float(data.get("pass_rate", (pass_count / total if total else 0.0)))
        tokens = int(data.get("total_tokens", 0))
        model = data.get("model", "")
        # These baseline/quartet records carry only a token total, so split it by the same assumed
        # input/output fraction the lab uses and price it through the editable table (bench.pricing).
        prompt = int(tokens * 0.6)
        cost_usd = pricing.cost_usd(model, prompt, tokens - prompt)
        configs.append({
            "key": key,
            "label": label,
            "model": model,
            "pass_rate": pass_rate,
            "pass_count": pass_count,
            "total": total,
            "total_tokens": tokens,
            "cost_usd": round(cost_usd, 6),
            "cost_per_solved": round(cost_usd / pass_count, 6) if pass_count else 0.0,
            "source": source,
        })
    return {"configs": configs}


# ---- request handler -------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # quieter console; the demo prints its own lines
        return

    def _cors(self):
        # Echo an allowed origin (the deployed frontend / localhost dev) so the browser accepts the
        # response; fall back to * for same-origin / tool use. No cookies are used, so no credentials.
        origin = self.headers.get("Origin")
        if origin and (origin in _ALLOWED_ORIGINS or _origin_is_local(origin)):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        else:
            self.send_header("Access-Control-Allow-Origin", "*")

    def _send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Quartet-Token")
        self.end_headers()

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, ValueError):
            return {}

    def _is_localhost(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].strip().lower()
        return host in ("127.0.0.1", "localhost", "[::1]", "::1", "")

    def _authorized(self) -> bool:
        """Gate the process-spawning + key control plane. Localhost requests pass (local dev). Over the
        public tunnel the Host is the tunnel hostname, so we require the shared token instead: a random
        page (or a DNS-rebinding attempt) cannot know QUARTET_API_TOKEN, and an unset token refuses all
        non-localhost control calls outright. The server still binds 127.0.0.1; the tunnel forwards to it."""
        if self._is_localhost():
            return True
        token = os.environ.get("QUARTET_API_TOKEN")
        return bool(token) and self.headers.get("X-Quartet-Token") == token

    # ---- control plane: keys + stacks (POST handlers; key values never returned) ----

    def _handle_save_key(self, body: dict) -> None:
        provider = body.get("provider") or ""
        try:
            status = save_provider_key(provider, body.get("api_key"), body.get("base_url"))
        except ValueError as e:
            self._send_json({"error": str(e)}, status=400)
            return
        self._send_json(status)  # booleans only, never the key

    def _handle_save_stack(self, body: dict) -> None:
        name = body.get("name") or ""
        try:
            saved = stacks.save_stack(name, body.get("config") or {})
        except ValueError as e:
            self._send_json({"error": str(e)}, status=400)
            return
        self._send_json({"saved": saved, "stacks": stacks.list_stacks()})

    def _handle_load_stack(self, body: dict) -> None:
        name = body.get("name") or ""
        try:
            active = stacks.activate_stack(name)  # writes the active run_config.json
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as e:
            self._send_json({"error": f"could not load stack: {str(e)[:120]}"}, status=400)
            return
        self._send_json(active)

    def _handle_duplicate_stack(self, body: dict) -> None:
        name = body.get("name") or ""
        new_name = body.get("new_name") or ""
        try:
            copy = stacks.duplicate_stack(name, new_name)
        except (ValueError, FileNotFoundError, json.JSONDecodeError) as e:
            self._send_json({"error": f"could not duplicate stack: {str(e)[:120]}"}, status=400)
            return
        self._send_json({"saved": copy, "stacks": stacks.list_stacks()})

    # ---- control plane: stack lab ----

    def _handle_lab_run(self, body: dict) -> None:
        stack = (body.get("stack") or "").strip()
        if not stack:
            self._send_json({"error": "stack required"}, status=400)
            return
        try:
            n = int(body.get("n") or 5)
        except (TypeError, ValueError):
            n = 5
        self._send_json(RUNS.start_lab(stack, n))

    def _handle_pricing_save(self, body: dict) -> None:
        # Accept a full table {model:{input,output}}, a {"table": {...}} wrapper, or a single
        # {model, input, output} row. save_pricing merges over the current table.
        if isinstance(body.get("table"), dict):
            table = body["table"]
        elif isinstance(body.get("model"), str):
            table = {body["model"]: {"input": body.get("input"), "output": body.get("output")}}
        else:
            table = body or {}
        self._send_json(pricing.save_pricing(table))

    # ---- control plane: build runs ----

    def _handle_build(self, body: dict) -> None:
        description = (body.get("description") or "").strip()
        if not description:
            self._send_json({"error": "description required"}, status=400)
            return
        project_type = (body.get("project_type") or "auto").lower()
        if project_type not in ("auto", "python", "static"):
            project_type = "auto"
        # Optional: apply a chosen stack as the active config before the build run.
        if isinstance(body.get("stack"), dict):
            run_config.save(body["stack"])
        self._send_json(RUNS.start_build(description, project_type))

    def _handle_build_chat(self, body: dict) -> None:
        """Conversational entry point: the user talks to the Orchestrator, which replies and kicks off
        the build. The user turn and the Orchestrator's reply are written into the run transcript so the
        Build chat shows the full conversation alongside the four agents' handoffs."""
        message = (body.get("message") or "").strip()
        if not message:
            self._send_json({"error": "message required"}, status=400)
            return
        project_type = (body.get("project_type") or "auto").lower()
        if project_type not in ("auto", "python", "static"):
            project_type = "auto"
        if isinstance(body.get("stack"), dict):
            run_config.save(body["stack"])
            
        confirm = body.get("confirm", False)
        run_id = body.get("run_id")

        if not run_id:
            import uuid
            from datetime import datetime, timezone
            run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8]

        self._append_chat_turn(run_id, "user", "You", message)

        if confirm:
            description = (body.get("description") or message).strip()
            status = RUNS.start_build(description, project_type, run_id=run_id)
            self._send_json({**status, "run_id": run_id, "project_type": project_type})
            return

        from orchestrator.orchestrator_chat import interpret

        plan = interpret(message, project_type)
        self._append_chat_turn(run_id, "orchestrator", "Orchestrator", plan["reply"])
        self._send_json({
            "run_id": run_id,
            "reply": plan["reply"],
            "description": plan["description"],
            "project_type": plan["project_type"],
            "needs_confirmation": True,
            "status": "idle"
        })

    def _append_chat_turn(self, run_id: str, role: str, sender: str, content: str) -> None:
        """Append one conversational turn to the run's message transcript (the same log the agents use),
        so _send_transcript merges it into the Build chat thread."""
        if not _RUN_ID_OK.match(run_id) or not content:
            return
        rec = {
            "ts": datetime.utcnow().isoformat() + "+00:00",
            "role": role,
            "sender": sender,
            "content": content,
            "mentions": [],
            "kind": "message",
        }
        try:
            TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
            with open(TRANSCRIPTS_DIR / f"{run_id}.messages.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(rec) + "\n")
        except OSError:
            pass

    # ---- /api/project* (the built project: tree, file, zip, static preview) ----

    def _send_project(self, qs: dict) -> None:
        run_id = (qs.get("run_id") or [""])[0]
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        d = PROJECTS_DIR / run_id
        if not d.is_dir():
            self._send_json({"run_id": run_id, "missing": True, "files": []})
            return
        manifest = _read_json(d / "_manifest.json") or {}
        files = []
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.name != "_manifest.json":
                files.append({"path": str(p.relative_to(d)), "size": p.stat().st_size})
        names = [f["path"] for f in files]
        readme_path = d / "README.md"
        self._send_json({
            "run_id": run_id,
            "type": manifest.get("type"),
            "passed": manifest.get("passed"),
            "description": manifest.get("description"),
            "files": files,
            "readme": readme_path.read_text(encoding="utf-8", errors="replace") if readme_path.is_file() else "",
            "has_static_entry": any(n == "index.html" or n.endswith("/index.html") for n in names),
            "zip": f"/api/project/zip?run_id={run_id}",
        })

    def _send_project_file(self, qs: dict) -> None:
        run_id = (qs.get("run_id") or [""])[0]
        rel = (qs.get("path") or [""])[0]
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        target = _safe_join(PROJECTS_DIR / run_id, rel)
        if target is None or not target.is_file():
            self._send_json({"error": "not found"}, status=404)
            return
        self._send_json({"path": rel, "content": target.read_text(encoding="utf-8", errors="replace")})

    def _send_project_zip(self, qs: dict) -> None:
        run_id = (qs.get("run_id") or [""])[0]
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        zp = PROJECTS_DIR / f"{run_id}.zip"
        if not zp.is_file():
            self._send_json({"error": "not found"}, status=404)
            return
        body = zp.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Disposition", f'attachment; filename="quartet-{run_id}.zip"')
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _serve_project_preview(self, path: str) -> None:
        """Serve a static file from a built project for the iframe preview. Scoped to the project dir
        and traversal-guarded. The client sandboxes the iframe; generated code never runs on the server."""
        rest = unquote(path[len("/api/project/preview/"):])
        run_id, _, rel = rest.partition("/")
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        target = _safe_join(PROJECTS_DIR / run_id, rel or "index.html")
        if target is None or not target.is_file():
            self._send_json({"error": "not found"}, status=404)
            return
        body = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        try:
            if path == "/api/runs":
                self._send_json(list_runs())
            elif path == "/api/results":
                self._send_json(build_results())
            elif path == "/api/events":
                self._send_events(parse_qs(parsed.query))
            elif path == "/api/transcript":
                self._send_transcript(parse_qs(parsed.query))
            elif path == "/api/models":
                self._send_json(run_config.load())
            elif path == "/api/keys":
                self._send_json(key_status())
            elif path == "/api/provider_models":
                provider = (parse_qs(parsed.query).get("provider") or [""])[0]
                self._send_json(list_provider_models(provider))
            elif path == "/api/stacks":
                self._send_json({"stacks": stacks.list_stacks()})
            elif path == "/api/lab/results":
                self._send_json({"results": list_lab_results()})
            elif path == "/api/lab/pricing":
                self._send_json(pricing.load_pricing())
            elif path == "/api/project":
                self._send_project(parse_qs(parsed.query))
            elif path == "/api/project/file":
                self._send_project_file(parse_qs(parsed.query))
            elif path == "/api/project/zip":
                self._send_project_zip(parse_qs(parsed.query))
            elif path.startswith("/api/project/preview/"):
                self._serve_project_preview(path)
            elif path == "/api/agents":
                self._send_json(RUNS.status())
            elif path == "/api/stream":
                self._stream(parse_qs(parsed.query))
            else:
                self._serve_static(path)
        except (BrokenPipeError, ConnectionResetError):
            pass  # client navigated away mid-stream; nothing to do

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if not self._authorized():
            self._send_json({"error": "forbidden"}, status=403)
            return
        try:
            if path == "/api/run":
                task_id = (self._read_body() or {}).get("task_id")
                if not task_id:
                    self._send_json({"error": "task_id required"}, status=400)
                    return
                self._send_json(RUNS.start(task_id))
            elif path == "/api/build":
                self._handle_build(self._read_body() or {})
            elif path == "/api/build/chat":
                self._handle_build_chat(self._read_body() or {})
            elif path == "/api/stop":
                RUNS.stop()
                self._send_json(RUNS.status())
            elif path == "/api/models":
                self._send_json(run_config.save(self._read_body() or {}))
            elif path == "/api/keys":
                self._handle_save_key(self._read_body() or {})
            elif path == "/api/validate":
                provider = (self._read_body() or {}).get("provider") or ""
                self._send_json(validate_provider(provider))
            elif path == "/api/stacks":
                self._handle_save_stack(self._read_body() or {})
            elif path == "/api/stacks/load":
                self._handle_load_stack(self._read_body() or {})
            elif path == "/api/stacks/duplicate":
                self._handle_duplicate_stack(self._read_body() or {})
            elif path == "/api/lab/run":
                self._handle_lab_run(self._read_body() or {})
            elif path == "/api/lab/pricing":
                self._handle_pricing_save(self._read_body() or {})
            else:
                self._send_json({"error": "not found"}, status=404)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ---- /api/events (whole run as one ordered array; drives client-side replay) ----

    def _send_events(self, qs: dict):
        run_id = (qs.get("run_id") or ["demo-golden"])[0]
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        events = read_events(str(EVENTS_DIR / f"{run_id}.jsonl"))
        events.sort(key=lambda e: e.get("ts", ""))
        self._send_json({"run_id": run_id, "events": events})

    # ---- /api/transcript (full agent message bodies for the reasoning panel) ----

    def _send_transcript(self, qs: dict):
        run_id = (qs.get("run_id") or ["demo-golden"])[0]
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        base = _read_json(TRANSCRIPTS_DIR / f"{run_id}.json") or {}
        # The agents log the real Spec->Coder->Tester->Repairer handoffs (the inbox-scoped conductor
        # cannot see them). Merge those with the conductor's own message(s) for a live run; for a
        # recorded/golden run there is no agent log, so use the bundled .json as-is.
        agent_msgs = _read_messages_jsonl(TRANSCRIPTS_DIR / f"{run_id}.messages.jsonl")
        if agent_msgs:
            messages = [m for m in base.get("messages", []) if m.get("role") == "conductor"] + agent_msgs
            messages.sort(key=lambda m: m.get("ts") or "")
        else:
            messages = base.get("messages", [])
        if not messages and not base:
            self._send_json({"run_id": run_id, "messages": [], "missing": True})
            return
        self._send_json({
            "run_id": run_id,
            "task_id": base.get("task_id"),
            "room_id": base.get("room_id"),
            "prompt": base.get("prompt", ""),
            "final_solution": base.get("final_solution", ""),
            "messages": messages,
        })

    # ---- SSE ----

    def _open_sse(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self._cors()
        self.end_headers()

    def _sse(self, data: dict, event: str | None = None):
        chunk = ""
        if event:
            chunk += f"event: {event}\n"
        chunk += f"data: {json.dumps(data)}\n\n"
        self.wfile.write(chunk.encode("utf-8"))
        self.wfile.flush()

    def _stream(self, qs: dict):
        run_id = (qs.get("run_id") or ["demo-golden"])[0]
        mode = (qs.get("mode") or ["replay"])[0]
        try:
            speed = float((qs.get("speed") or ["1"])[0])
        except ValueError:
            speed = 1.0
        speed = max(speed, 0.1)
        if not _RUN_ID_OK.match(run_id):
            self._send_json({"error": "bad run_id"}, status=400)
            return
        path = EVENTS_DIR / f"{run_id}.jsonl"
        self._open_sse()
        if mode == "live":
            self._stream_live(path)
        else:
            self._stream_replay(path, speed)

    def _stream_replay(self, path: Path, speed: float):
        events = read_events(str(path))
        events.sort(key=lambda e: e.get("ts", ""))
        self._sse({"count": len(events), "run_id": path.stem}, event="start")
        prev = None
        for ev in events:
            now = _parse_ts(ev.get("ts"))
            if prev is not None and now is not None:
                gap = (now - prev).total_seconds()
                if gap > 0:
                    time.sleep(min(gap / speed, _REPLAY_GAP_CAP))
            prev = now
            self._sse(ev)
        self._sse({}, event="end")

    def _stream_live(self, path: Path):
        run_id = path.stem
        self._sse({"run_id": run_id, "mode": "live"}, event="start")
        pos = 0
        buf = ""
        idle = 0.0
        while idle < 300:  # give up after 5 min of no new data (a single problem ends well before)
            new = ""
            if path.exists():
                with open(path, encoding="utf-8") as f:
                    f.seek(pos)
                    new = f.read()
                    pos = f.tell()
            if new:
                idle = 0.0
                buf += new
                *lines, buf = buf.split("\n")
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    self._sse(ev)
                    # The challenger emits its own scored event; a single race/build run ends when the
                    # conductor scores the Quartet. A lab scores every problem, so do NOT end there:
                    # keep streaming until the whole lab run is terminal (caught by the idle branch).
                    if ev.get("type") == "scored" and ev.get("role") == "conductor":
                        st = RUNS.status()
                        if st.get("run_id") != run_id or st.get("mode") != "lab" or not st.get("active"):
                            self._sse({}, event="end")
                            return
            else:
                idle += _LIVE_POLL
                # End promptly if this run reached a terminal state without a conductor scored event
                # (e.g. it failed config preflight and wrote no events), instead of idling for minutes.
                st = RUNS.status()
                if st.get("run_id") == run_id and not st.get("active") and st.get("status") in ("error", "stopped", "done"):
                    self._sse({"status": st.get("status"), "error": st.get("error")}, event="end")
                    return
            self._sse({}, event="ping")
            time.sleep(_LIVE_POLL)
        self._sse({}, event="end")

    # ---- static (built frontend) ----

    def _serve_static(self, path: str):
        if not WEB_DIST.exists():
            self._placeholder()
            return
        rel = path.lstrip("/") or "index.html"
        target = (WEB_DIST / rel).resolve()
        if WEB_DIST not in target.parents and target != WEB_DIST:
            target = WEB_DIST / "index.html"  # block traversal
        if not target.is_file():
            target = WEB_DIST / "index.html"  # SPA fallback
        body = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _placeholder(self):
        html = (
            "<!doctype html><meta charset=utf-8>"
            "<body style='font:16px/1.5 system-ui;background:#0b0f1a;color:#e5e7eb;padding:3rem'>"
            "<h1>Quartet demo server</h1>"
            "<p>API is live. The frontend is not built yet.</p>"
            "<p>Dev: <code>cd web &amp;&amp; npm install &amp;&amp; npm run dev</code> "
            "(Vite proxies <code>/api</code> here).<br>"
            "Prod: <code>cd web &amp;&amp; npm run build</code>, then reload this page.</p>"
            "<p>Try <a style='color:#60a5fa' href='/api/runs'>/api/runs</a> or "
            "<a style='color:#60a5fa' href='/api/results'>/api/results</a>.</p></body>"
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(html)))
        self._cors()
        self.end_headers()
        self.wfile.write(html)


def _parse_ts(ts: str | None):
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts)
    except ValueError:
        return None


def main() -> None:
    ap = argparse.ArgumentParser(description="Read-only SSE bridge for the Quartet demo.")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    EVENTS_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[demo] serving on http://{args.host}:{args.port}")
    print(f"[demo] runs dir: {EVENTS_DIR}")
    print(f"[demo] frontend: {'web/dist (built)' if WEB_DIST.exists() else 'not built - use npm run dev'}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[demo] shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
