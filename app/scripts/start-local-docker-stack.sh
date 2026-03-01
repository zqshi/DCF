#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="$APP_DIR/docker/local"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_FILE="$STACK_DIR/.env"
APP_ENV_FILE="$APP_DIR/.env"
USE_DOCKER_OPENCLAW="${DCF_USE_DOCKER_OPENCLAW:-0}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing dependency: $1" >&2
    exit 1
  fi
}

read_env_value() {
  local file="$1"
  local key="$2"
  [ -f "$file" ] || return 1
  local line
  line="$(grep -E "^${key}=" "$file" | tail -n 1 || true)"
  [ -n "$line" ] || return 1
  echo "${line#*=}"
}

require_cmd docker
docker compose version >/dev/null

mkdir -p "$STACK_DIR/openclaw-config" "$STACK_DIR/openclaw-workspace"

if [[ ! -f "$ENV_FILE" ]]; then
  OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 24 2>/dev/null || python3 - <<'PY'
import secrets
print(secrets.token_hex(24))
PY
)"
  cat >"$ENV_FILE" <<EOF
OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}
WEKNORA_API_KEY=
EOF
fi

echo "[1/3] starting local dependencies"
if [[ "$USE_DOCKER_OPENCLAW" = "1" ]]; then
  echo " - openclaw via docker compose"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build openclaw-gateway
else
  echo " - openclaw via DCF start-all local process (docker openclaw skipped)"
fi

WEKNORA_BASE_URL="${WEKNORA_BASE_URL:-$(read_env_value "$APP_ENV_FILE" "WEKNORA_BASE_URL" || true)}"
WEKNORA_WEB_URL="${WEKNORA_WEB_URL:-$(read_env_value "$APP_ENV_FILE" "WEKNORA_WEB_URL" || true)}"
if [[ -z "${WEKNORA_BASE_URL:-}" ]]; then
  WEKNORA_BASE_URL="http://127.0.0.1:19080"
fi
if [[ -z "${WEKNORA_WEB_URL:-}" ]]; then
  WEKNORA_WEB_URL="http://127.0.0.1:19080/platform/knowledge-bases"
fi

echo "[2/3] starting official WeKnora"
if [[ -x "$APP_DIR/scripts/start-official-weknora.sh" ]]; then
  WEKNORA_BASE_URL="$WEKNORA_BASE_URL" WEKNORA_WEB_URL="$WEKNORA_WEB_URL" \
    bash "$APP_DIR/scripts/start-official-weknora.sh"
else
  echo "error: missing script $APP_DIR/scripts/start-official-weknora.sh"
  exit 1
fi

echo "[3/3] endpoints"
echo "openclaw gateway: http://127.0.0.1:18789"
echo "weknora api:      ${WEKNORA_BASE_URL%/}/api/v1"
echo "weknora web:      ${WEKNORA_WEB_URL}"
echo "env file:         $ENV_FILE"
