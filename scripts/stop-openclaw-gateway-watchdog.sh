#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/.run/openclaw-watchdog.pid"

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete openclaw-watchdog >/dev/null 2>&1 || true
fi

if [ ! -f "$PID_FILE" ]; then
  echo "watchdog not running (pid file missing)"
  exit 0
fi

PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ -n "${PID:-}" ] && kill -0 "$PID" >/dev/null 2>&1; then
  kill "$PID" >/dev/null 2>&1 || true
  echo "watchdog stopped (pid=$PID)"
else
  echo "watchdog already stopped"
fi

rm -f "$PID_FILE"
