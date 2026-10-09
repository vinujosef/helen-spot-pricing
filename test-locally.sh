#!/bin/sh
set -eu

cd "$(dirname "$0")"

PORT=8090
URL="http://127.0.0.1:$PORT"

python3 -m http.server "$PORT" --bind 127.0.0.1 &
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
