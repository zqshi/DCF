#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPENCLAW_DIR="$ROOT_DIR/runtime/openclaw"
APP_ENV_FILE="${DCF_APP_ENV_FILE:-$ROOT_DIR/app/.env}"
RUN_DIR="$ROOT_DIR/.run"
LOG_FILE="$RUN_DIR/openclaw-watchdog.log"
PID_FILE="$RUN_DIR/openclaw-watchdog.pid"
mkdir -p "$RUN_DIR" "$OPENCLAW_DIR/logs" "$OPENCLAW_DIR/.openclaw-state"

if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" >/dev/null 2>&1; then
    echo "[watchdog] already running (pid=$OLD_PID)"
    exit 0
  fi
fi

if [ -f "$APP_ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$APP_ENV_FILE"
  set +a
fi

OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:18789}"
OPENCLAW_HOST="${OPENCLAW_BASE_URL%/}"
OPENCLAW_PORT="${OPENCLAW_HOST##*:}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}"
OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-$OPENCLAW_DIR/.openclaw-state/dcf-openclaw.json}"

start_gateway() {
  if lsof -nP -tiTCP:"$OPENCLAW_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    return 0
  fi
  echo "[watchdog] gateway down, starting at $(date '+%F %T %z')" | tee -a "$LOG_FILE"
  (
    cd "$OPENCLAW_DIR"
    OPENCLAW_STATE_DIR="$OPENCLAW_DIR/.openclaw-state" \
    OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
    OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
    DCF_RUNTIME_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}" \
    DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}" \
    DCF_RUNTIME_RUN_DELAY_MS="${DCF_RUNTIME_RUN_DELAY_MS:-80}" \
    DCF_RUNTIME_REQUEST_TIMEOUT_MS="${DCF_RUNTIME_REQUEST_TIMEOUT_MS:-120000}" \
    DCF_RUNTIME_MAX_TASK_MS="${DCF_RUNTIME_MAX_TASK_MS:-240000}" \
    DCF_OPENCLAW_GATEWAY_BASE_URL="$OPENCLAW_HOST" \
    OPENCLAW_SKIP_CHANNELS="${OPENCLAW_SKIP_CHANNELS:-0}" \
    nohup node dist/index.js gateway --allow-unconfigured --bind loopback --port "$OPENCLAW_PORT" \
      >> "$OPENCLAW_DIR/logs/gateway.log" 2>&1 &
    echo $! > "$RUN_DIR/openclaw.pid"
  )
}

echo "$$" > "$PID_FILE"
echo "[watchdog] started (pid=$$) at $(date '+%F %T %z')" | tee -a "$LOG_FILE"

while true; do
  if ! curl -sS -m 2 -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" "${OPENCLAW_HOST}/runtime/health" >/dev/null 2>&1; then
    start_gateway
  fi
  sleep "${DCF_GATEWAY_WATCHDOG_INTERVAL_SEC:-5}"
done
