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
  GET  /api/agents                                 live run + agent process status
  POST /api/run     {task_id}                      start a real live Quartet run + large race
  POST /api/stop                                   stop the active run
Anything else is served from the built frontend at web/dist/ (SPA fallback to index.html).
The control-plane endpoints bind to 127.0.0.1 only and never return API keys.

Cost note: cost_usd is derived here from a small static price map times the token counts in the
results files. Local-provider runs frequently report total_tokens=0 (the OpenAI-compatible server
omits usage), so cost is only meaningful for aimlapi runs or the bundled sample.

Run: uv run python -m orchestrator.demo_server  [--host 127.0.0.1] [--port 8000]
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import re
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bench.events import read_events
from orchestrator import run_config
from orchestrator.runner import RunManager

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "results"
EVENTS_DIR = RESULTS / "events"
TRANSCRIPTS_DIR = RESULTS / "transcripts"
WEB_DIST = ROOT / "web" / "dist"
SAMPLE_RESULTS = RESULTS / "demo-results.sample.json"

# Single live run at a time, shared across handler threads.
RUNS = RunManager()

_RUN_ID_OK = re.compile(r"^[A-Za-z0-9._-]+$")  # guards the run_id -> filename mapping (no traversal)
_REPLAY_GAP_CAP = 2.0  # never sit on dead air longer than this between two replayed events
_LIVE_POLL = 0.3       # seconds between polls when tailing an active run

# Illustrative price tiers ($ per 1M tokens). Quartet agents are the small tier; the 32B baseline is
# the large tier. Verify against aimlapi.com/models before quoting these as real.
_PRICE_PER_1M = {"small": 0.20, "large": 0.80}
_LARGE_HINTS = ("32b", "34b", "70b", "72b", "large")


def _price_per_token(model: str) -> float:
    tier = "large" if any(h in (model or "").lower() for h in _LARGE_HINTS) else "small"
    return _PRICE_PER_1M[tier] / 1_000_000


def _read_json(path: Path):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return None


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
        cost_usd = tokens * _price_per_token(model)
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
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, ValueError):
            return {}

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
        try:
            if path == "/api/run":
                task_id = (self._read_body() or {}).get("task_id")
                if not task_id:
                    self._send_json({"error": "task_id required"}, status=400)
                    return
                self._send_json(RUNS.start(task_id))
            elif path == "/api/stop":
                RUNS.stop()
                self._send_json(RUNS.status())
            elif path == "/api/models":
                self._send_json(run_config.save(self._read_body() or {}))
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
        data = _read_json(TRANSCRIPTS_DIR / f"{run_id}.json")
        if data is None:
            self._send_json({"run_id": run_id, "messages": [], "missing": True})
            return
        self._send_json(data)

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
        self._sse({"run_id": path.stem, "mode": "live"}, event="start")
        pos = 0
        buf = ""
        idle = 0.0
        while idle < 900:  # give up after 15 min of no new data
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
                        # The challenger emits its own scored event; the run ends only when the
                        # conductor scores the Quartet (pass, fail, or timeout all reach here).
                        if ev.get("type") == "scored" and ev.get("role") == "conductor":
                            self._sse({}, event="end")
                            return
                else:
                    idle += _LIVE_POLL
            else:
                idle += _LIVE_POLL
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
