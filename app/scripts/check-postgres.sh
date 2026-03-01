#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -z "${POSTGRES_URL:-}" ]; then
  echo "POSTGRES_URL is required" >&2
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install
fi
DB_DRIVER=postgres PORT=8093 node src/server.js >/tmp/dcf-postgres.log 2>&1 &
PID=$!
sleep 1
curl -sS http://127.0.0.1:8093/api/health
curl -sS http://127.0.0.1:8093/api/admin/runtime-status
kill $PID || true
wait $PID 2>/dev/null || true
echo "postgres check done"
