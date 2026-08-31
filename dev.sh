#!/usr/bin/env bash
# Start both dev processes: the Next.js app and the Python engine.
# - If the default ports (3000 app / 8000 engine) are busy, the next free port
#   is picked automatically.
# - Ctrl-C (or either process dying) stops both.
#
# Usage: ./dev.sh [--prod]
# Env overrides: PORT, ENGINE_PORT, ENGINE_HOST

set -euo pipefail
cd "$(dirname "$0")"

PROD=0
[[ "${1:-}" == "--prod" ]] && PROD=1

ENGINE_HOST="${ENGINE_HOST:-127.0.0.1}"

# Fail fast and legibly: without these the engine dies inside the port wait
# loop below, which reads as a timeout rather than a missing dependency.
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install Python 3.11 or newer, then run this again." >&2
  exit 1
fi
if ! (cd engine && python3 -c "import tinyhouse" >/dev/null 2>&1); then
  echo "Cannot import the 'tinyhouse' engine package from ./engine." >&2
  echo "Check that ./engine/tinyhouse/__init__.py exists and python3 can read it." >&2
  exit 1
fi

port_open() { (exec 3<>"/dev/tcp/${ENGINE_HOST}/$1") 2>/dev/null; }

# First free port >= $1.
find_free_port() {
  local p=$1
  while port_open "$p"; do
    p=$((p + 1))
  done
  echo "$p"
}

ENGINE_PORT="${ENGINE_PORT:-$(find_free_port 8000)}"
APP_PORT="${PORT:-$(find_free_port 3000)}"

cleanup() {
  echo
  echo "Shutting down..."
  kill "${APP_PID:-}" "${ENGINE_PID:-}" 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Starting engine on ${ENGINE_HOST}:${ENGINE_PORT}..."
(cd engine && exec python3 -m tinyhouse serve --host "$ENGINE_HOST" --port "$ENGINE_PORT") &
ENGINE_PID=$!

# Wait until the engine accepts connections (and confirm it's ours, not a crash).
ENGINE_UP=0
for _ in $(seq 1 50); do
  if port_open "$ENGINE_PORT"; then ENGINE_UP=1; break; fi
  kill -0 "$ENGINE_PID" 2>/dev/null || break
  sleep 0.2
done
if [[ "$ENGINE_UP" -ne 1 ]] || ! kill -0 "$ENGINE_PID" 2>/dev/null; then
  echo "Engine failed to start." >&2
  exit 1
fi
echo "Engine is up (pid $ENGINE_PID)."

if [[ "$PROD" -eq 1 ]]; then
  echo "Building Next.js app..."
  npm run build
  echo "Starting Next.js app (production)..."
  ENGINE_URL="http://${ENGINE_HOST}:${ENGINE_PORT}" npm run next:start -- -p "$APP_PORT" &
else
  echo "Starting Next.js dev server..."
  ENGINE_URL="http://${ENGINE_HOST}:${ENGINE_PORT}" npm run dev -- -p "$APP_PORT" &
fi
APP_PID=$!

echo
echo "  App:    http://localhost:${APP_PORT}"
echo "  Engine: http://${ENGINE_HOST}:${ENGINE_PORT}"
echo

wait "$APP_PID"
