#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="$APP_DIR/docker/local"
ENV_FILE="$STACK_DIR/.env"
APP_ENV_FILE="$APP_DIR/.env"
OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}"

read_env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  echo "${line#*=}"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE. run scripts/start-local-docker-stack.sh first."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"
WEKNORA_BASE_URL="${WEKNORA_BASE_URL:-$(read_env_value "$APP_ENV_FILE" "WEKNORA_BASE_URL" || true)}"
WEKNORA_WEB_URL="${WEKNORA_WEB_URL:-$(read_env_value "$APP_ENV_FILE" "WEKNORA_WEB_URL" || true)}"
if [[ -z "${WEKNORA_BASE_URL:-}" ]]; then
  WEKNORA_BASE_URL="http://127.0.0.1:19080"
fi
if [[ -z "${WEKNORA_WEB_URL:-}" ]]; then
  WEKNORA_WEB_URL="http://127.0.0.1:19080/platform/knowledge-bases"
fi

echo "[1/4] openclaw gateway root"
curl -sS -m 3 "${OPENCLAW_BASE_URL%/}/" >/dev/null
echo "ok: ${OPENCLAW_BASE_URL%/}/"

echo "[2/4] openclaw runtime health"
curl -sS -m 3 -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" "${OPENCLAW_BASE_URL%/}/runtime/health" >/dev/null
echo "ok: ${OPENCLAW_BASE_URL%/}/runtime/health"

echo "[3/4] official weknora health+web"
if [[ -x "$APP_DIR/scripts/check-official-weknora.sh" ]]; then
  WEKNORA_BASE_URL="$WEKNORA_BASE_URL" WEKNORA_WEB_URL="$WEKNORA_WEB_URL" \
    bash "$APP_DIR/scripts/check-official-weknora.sh"
else
  echo "error: missing script $APP_DIR/scripts/check-official-weknora.sh"
  exit 1
fi

echo "[4/4] weknora api auth check"
if [[ -z "${WEKNORA_API_KEY:-}" ]]; then
  echo "error: WEKNORA_API_KEY is empty in $ENV_FILE"
  exit 1
fi
curl -sS -m 3 -H "X-API-Key: ${WEKNORA_API_KEY}" -H "Content-Type: application/json" \
  -d '{"name":"DCF WeKnora Check","description":"dcf check"}' \
  "${WEKNORA_BASE_URL%/}/api/v1/knowledge-bases" >/dev/null
echo "ok: api key accepted by ${WEKNORA_BASE_URL%/}/api/v1/knowledge-bases"

echo "local docker stack check: passed"
