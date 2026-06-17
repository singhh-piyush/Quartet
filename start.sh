#!/usr/bin/env bash
# start.sh - launch the Quartet demo, each piece in its own terminal.
#
# With the new launcher you do NOT start the four agents by hand: the demo server spawns them (and
# the large-model race) when you click "Run live". So "everything" is just:
#   1. your local model server on :8080 (inference for live runs)   - optional, see MODEL_SERVER_CMD
#   2. the demo server (backend + run launcher + static frontend)
#   3. the frontend (Vite dev server, or a one-off build served by the demo server)
#
# Usage:
#   ./start.sh            # dev: demo server + Vite, opens http://localhost:5173
#   ./start.sh build      # build the frontend once, serve everything from http://localhost:8000
#   MODEL_SERVER_CMD="llama-server -m model.gguf --jinja --port 8080" ./start.sh
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MODE="${1:-dev}"

# Command that starts the local model server on :8080. Both the four Band agents and the single large
# competitor use this one server (we are local-only: no aimlapi). Override by exporting MODEL_SERVER_CMD
# before running, or set it to "" to start the server yourself in another window. The default below is
# the project's local Qwen3.6 build, launched from ~/ai_models. It must serve on :8080 with --jinja so
# the agents can tool-call (band_send_message).
DEFAULT_MODEL_CMD='cd ~/ai_models && exec llama-server \
  -m Qwen3.6-35B-A3B-Claude-4.7-Opus-Reasoning-Distilled.IQ4_XS.gguf \
  -ngl 999 \
  --n-cpu-moe 999 \
  --no-mmap \
  --ctx-size 262144 \
  --flash-attn on \
  --cache-type-k q4_0 \
  --cache-type-v q4_0 \
  -np 1 \
  -b 4096 -ub 2048 \
  -t 20 -tb 20 \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0.00 \
  --jinja \
  --reasoning-format deepseek \
  --port 8080'
MODEL_SERVER_CMD="${MODEL_SERVER_CMD-$DEFAULT_MODEL_CMD}"

RUNDIR="$(mktemp -d "${TMPDIR:-/tmp}/quartet-run.XXXXXX")"

# Write a component's commands to a throwaway script and open it in a terminal window. Using a file
# avoids all the nested-quoting pain across the many terminal emulators.
make_script() {
  local name="$1" body="$2"
  local f="$RUNDIR/$name.sh"
  cat > "$f" <<EOF
#!/usr/bin/env bash
cd "$ROOT"
echo "== $name =="
$body
code=\$?
echo
echo "[$name] exited (code \$code). Press Enter to close."
read -r _
EOF
  chmod +x "$f"
  printf '%s' "$f"
}

open_terminal() {
  local title="$1" script="$2"
  if   command -v gnome-terminal   >/dev/null 2>&1; then gnome-terminal --title="$title" -- bash "$script" >/dev/null 2>&1 &
  elif command -v konsole          >/dev/null 2>&1; then konsole -p tabtitle="$title" -e bash "$script" >/dev/null 2>&1 &
  elif command -v xfce4-terminal   >/dev/null 2>&1; then xfce4-terminal --title="$title" --command="bash $script" >/dev/null 2>&1 &
  elif command -v tilix            >/dev/null 2>&1; then tilix -t "$title" -e "bash $script" >/dev/null 2>&1 &
  elif command -v alacritty        >/dev/null 2>&1; then alacritty -t "$title" -e bash "$script" >/dev/null 2>&1 &
  elif command -v kitty            >/dev/null 2>&1; then kitty --title "$title" bash "$script" >/dev/null 2>&1 &
  elif command -v xterm            >/dev/null 2>&1; then xterm -T "$title" -e bash "$script" >/dev/null 2>&1 &
  elif command -v x-terminal-emulator >/dev/null 2>&1; then x-terminal-emulator -T "$title" -e bash "$script" >/dev/null 2>&1 &
  else return 1
  fi
  return 0
}

HAVE_TERM=1
if ! { command -v gnome-terminal || command -v konsole || command -v xfce4-terminal || command -v tilix \
     || command -v alacritty || command -v kitty || command -v xterm || command -v x-terminal-emulator; } >/dev/null 2>&1; then
  HAVE_TERM=0
fi

# --- component command bodies ---
SERVER_BODY='exec uv run python -m orchestrator.demo_server --port 8000'
VITE_BODY='[ -d web/node_modules ] || (cd web && npm install); cd web && exec npm run dev'

declare -a NAMES=() BODIES=()
if [ -n "$MODEL_SERVER_CMD" ]; then
  if curl -s -o /dev/null --max-time 2 "http://localhost:8080/v1/models" 2>/dev/null; then
    echo "[start] model server already serving on :8080 (reusing it)."
  else
    NAMES+=("model-server"); BODIES+=("$MODEL_SERVER_CMD")
  fi
fi
if curl -s -o /dev/null --max-time 2 "http://localhost:8000/api/models" 2>/dev/null; then
  echo "[start] demo server already running on :8000 (reusing it)."
else
  NAMES+=("demo-server"); BODIES+=("$SERVER_BODY")
fi

URL="http://localhost:8000"
if [ "$MODE" = "build" ]; then
  echo "[start] building the frontend (web/dist)..."
  ( [ -d web/node_modules ] || (cd web && npm install) ) && (cd web && npm run build)
  URL="http://localhost:8000"
else
  NAMES+=("frontend-vite"); BODIES+=("$VITE_BODY")
  URL="http://localhost:5173"
fi

# --- launch ---
launch_all_terminals() {
  local i
  for i in "${!NAMES[@]}"; do
    local f; f="$(make_script "${NAMES[$i]}" "${BODIES[$i]}")"
    open_terminal "quartet: ${NAMES[$i]}" "$f" || return 1
    sleep 0.4
  done
  return 0
}

launch_tmux() {
  local session="quartet" i
  tmux kill-session -t "$session" 2>/dev/null || true
  tmux new-session -d -s "$session" -n "${NAMES[0]}" "bash $(make_script "${NAMES[0]}" "${BODIES[0]}")"
  for i in $(seq 1 $((${#NAMES[@]} - 1))); do
    tmux new-window -t "$session" -n "${NAMES[$i]}" "bash $(make_script "${NAMES[$i]}" "${BODIES[$i]}")"
  done
  echo "[start] launched in tmux session '$session'. Attach with:  tmux attach -t $session"
}

launch_background() {
  mkdir -p results/logs
  local i
  for i in "${!NAMES[@]}"; do
    local log="results/logs/start-${NAMES[$i]}.log"
    bash "$(make_script "${NAMES[$i]}" "${BODIES[$i]}")" >"$log" 2>&1 &
    echo "[start] ${NAMES[$i]} -> $log (pid $!)"
  done
  echo "[start] stop everything with:  pkill -f 'demo_server|vite|agents\\.'  (and your model server)"
}

echo "[start] mode=$MODE  components: ${NAMES[*]}"
if [ "$HAVE_TERM" = "1" ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && launch_all_terminals; then
  echo "[start] opened ${#NAMES[@]} terminal window(s)."
elif command -v tmux >/dev/null 2>&1; then
  echo "[start] no GUI terminal; using tmux."
  launch_tmux
else
  echo "[start] no GUI terminal or tmux; running in the background with logs."
  launch_background
fi

if [ -z "$MODEL_SERVER_CMD" ]; then
  echo "[start] note: MODEL_SERVER_CMD is empty. Live runs need the local model server on :8080 (both the"
  echo "        agents and the large competitor use it). Start it yourself, or unset MODEL_SERVER_CMD to"
  echo "        use the built-in default (~/ai_models llama-server)."
else
  echo "[start] note: agents + large model are local-only (provider=local, server on :8080). The model"
  echo "        can take a while to load; live runs warn until :8080 answers."
fi

echo "[start] waiting for the demo server..."
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:8000/api/models" 2>/dev/null && break
  sleep 1
done

echo "[start] opening $URL"
( command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 ) \
  || ( command -v open >/dev/null 2>&1 && open "$URL" >/dev/null 2>&1 ) \
  || echo "[start] open $URL in your browser."

echo "[start] done. In the UI: Live mode -> pick a problem -> Run live (or Replay for the recorded run)."
