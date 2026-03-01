#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then
  npm install
fi
DB_DRIVER=sqlite SQLITE_PATH=./data/dcf.sqlite PORT=8092 node src/server.js >/tmp/dcf-sqlite.log 2>&1 &
PID=$!
sleep 1
curl -sS http://127.0.0.1:8092/api/health
curl -sS http://127.0.0.1:8092/api/admin/runtime-status
kill $PID || true
wait $PID 2>/dev/null || true
echo "sqlite check done"
