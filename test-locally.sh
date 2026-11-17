#!/bin/sh
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Missing .env; copy .env.example to .env and set the server configuration." >&2
  exit 1
fi

. ./.env

: "${HOST:?Set HOST in .env}"
: "${PORT:?Set PORT in .env}"
URL="http://$HOST:$PORT"

python3 -m http.server "$PORT" --bind "$HOST" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
  exit $?
fi

open "$URL"
echo "Serving PowerPrice Helen at $URL"
echo "Press Ctrl+C to stop the server."
wait "$SERVER_PID"
