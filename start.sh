#!/usr/bin/env bash
# start.sh - launch the Quartet demo, each piece in its own terminal.
#
# With the new launcher you do NOT start the four agents by hand: the demo server spawns them (and
# the large-model race) when you click "Run live". So "everything" is just:
#   1. two local model servers: large = Qwen3.6 on :8080, agents = small coder on :8081 (live runs)
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

# Two local model servers (the default topology):
#   :8080  LARGE competitor only  - the project's Qwen3.6-35B build (CPU-MoE, big context).
#   :8081  the four Band agents   - a small coder model (genuinely "small" vs the 35B, and on its own
#                                   generation slot so the race against the large model is truly parallel).
# Each server: override by exporting MODEL_SERVER_CMD / AGENTS_MODEL_CMD before running, or set to "" to
# start that server yourself. Both must serve with --jinja so the agents can tool-call (band_send_message).
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

# Agents server on :8081: a small Qwen2.5-Coder-7B (proven tool-caller, non-reasoning, fast). Modest
# context (agents do not need 262k). Runs on CPU (-ngl 0): on this box the 35B large model + its 262k
# KV cache already fills the 8GB GPU, leaving no room for the 7B, so the agents use the (ample) system
# RAM + CPU threads instead. A 7B on CPU is still much faster than the 35B was, and it is a SEPARATE
# server/slot so the race stays concurrent. If you free GPU VRAM (e.g. drop the large model's
# --ctx-size), set -ngl 999 here to put the agents on the GPU. Swap -m to use another ~/ai_models GGUF.
DEFAULT_AGENTS_MODEL_CMD='cd ~/ai_models && exec llama-server \
  -m WhiteRabbitNeo-WhiteRabbitNeo-2.5-Qwen-2.5-Coder-7B-latest.gguf \
  -ngl 0 \
  --ctx-size 8192 \
  -t 8 -tb 8 \
  -np 1 \
  -b 1024 -ub 256 \
  --jinja \
  --port 8081'
AGENTS_MODEL_CMD="${AGENTS_MODEL_CMD-$DEFAULT_AGENTS_MODEL_CMD}"

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
    echo "[start] large model server already serving on :8080 (reusing it)."
  else
    NAMES+=("model-server-large"); BODIES+=("$MODEL_SERVER_CMD")
  fi
fi
if [ -n "$AGENTS_MODEL_CMD" ]; then
  if curl -s -o /dev/null --max-time 2 "http://localhost:8081/v1/models" 2>/dev/null; then
    echo "[start] agents model server already serving on :8081 (reusing it)."
  else
    NAMES+=("model-server-agents"); BODIES+=("$AGENTS_MODEL_CMD")
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

if [ -z "$MODEL_SERVER_CMD" ] || [ -z "$AGENTS_MODEL_CMD" ]; then
  echo "[start] note: live runs need TWO local servers - the large competitor on :8080 and the four"
  echo "        agents (small coder model) on :8081. Start any you set to empty yourself, or unset the"
  echo "        var to use the built-in default (~/ai_models llama-server)."
else
  echo "[start] note: local-only, two servers - large = Qwen3.6 on :8080, agents = small coder on :8081"
  echo "        (separate slots, so the race is truly parallel). Models can take a while to load; live"
  echo "        runs warn until both answer."
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
