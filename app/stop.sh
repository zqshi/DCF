#!/usr/bin/env bash
set -euo pipefail
PORT="${PORT:-8080}"
STOPPED=""

PORT_PIDS=$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN || true)
if [ -n "${PORT_PIDS}" ]; then
  kill ${PORT_PIDS}
  STOPPED="${STOPPED} ${PORT_PIDS}"
fi

# Fallback: stop this project's backend process even when listening on a non-default port.
APP_PIDS=$(ps -ef | grep "node src/server.js" | grep "/Users/zqs/Downloads/project/DCF/app" | awk '{print $2}' || true)
if [ -n "${APP_PIDS}" ]; then
  kill ${APP_PIDS} || true
  STOPPED="${STOPPED} ${APP_PIDS}"
fi

if [ -n "$(echo "${STOPPED}" | xargs)" ]; then
  echo "Stopped: $(echo "${STOPPED}" | xargs)"
else
  echo "No backend process found (port=${PORT})"
fi
