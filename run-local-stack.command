#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$ROOT_DIR/.run/local-stack-guardian.log"
mkdir -p "$ROOT_DIR/.run"

cd "$ROOT_DIR"

echo "[guardian] boot at $(date '+%F %T %z')" | tee -a "$LOG_FILE"

restart_stack() {
  echo "[guardian] restart stack at $(date '+%F %T %z')" | tee -a "$LOG_FILE"
  ./stop-all.sh >>"$LOG_FILE" 2>&1 || true
  local app_port="${PORT:-8091}"
  if PORT="$app_port" \
    FRONT_KNOWLEDGE_ENTRY_ENABLED=1 \
    FRONT_KNOWLEDGE_ENTRY_MODE=external \
    DCF_REGISTRY_CHECK_ENABLED=0 \
    DCF_USE_LOCAL_DOCKER_DEPS=0 \
    DCF_DOCKER_DEPS_REQUIRED=0 \
    DCF_POLICY_AUTO_APPLY=0 \
    ./start-all.sh >>"$LOG_FILE" 2>&1; then
    echo "[guardian] stack ready on :${app_port}" | tee -a "$LOG_FILE"
    return 0
  fi
  echo "[guardian] start failed, will retry" | tee -a "$LOG_FILE"
  return 1
}

restart_stack || true

while true; do
  app_port="${PORT:-8091}"
  if ! curl -sS -m 2 "http://127.0.0.1:${app_port}/api/health" >/dev/null 2>&1; then
    echo "[guardian] health check failed, restarting..." | tee -a "$LOG_FILE"
    restart_stack || true
    sleep 5
    continue
  fi
  if ! curl -sS -m 2 "http://127.0.0.1:19080/health" >/dev/null 2>&1; then
    echo "[guardian] WeKnora health check failed, restarting..." | tee -a "$LOG_FILE"
    restart_stack || true
  fi
  sleep 5
done
