#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEKNORA_DIR="${WEKNORA_DIR:-$APP_DIR/vendor/WeKnora}"
WEKNORA_ENV_FILE="$WEKNORA_DIR/.env"
WEKNORA_ENV_EXAMPLE="$WEKNORA_DIR/.env.example"
WEKNORA_WEB_PORT="${DCF_WEKNORA_WEB_PORT:-19080}"
WEKNORA_APP_PORT="${DCF_WEKNORA_APP_PORT:-18080}"
WEKNORA_BASE_URL="${WEKNORA_BASE_URL:-http://127.0.0.1:${WEKNORA_WEB_PORT}}"
WEKNORA_WEB_URL="${WEKNORA_WEB_URL:-http://127.0.0.1:${WEKNORA_WEB_PORT}/platform/knowledge-bases}"
WEKNORA_START_RETRIES="${DCF_WEKNORA_START_RETRIES:-3}"
DOCKER_CLIENT_TIMEOUT="${DOCKER_CLIENT_TIMEOUT:-600}"
COMPOSE_HTTP_TIMEOUT="${COMPOSE_HTTP_TIMEOUT:-600}"
REGISTRY_CHECK_ENABLED="${DCF_REGISTRY_CHECK_ENABLED:-1}"
WEKNORA_START_STRATEGY="${DCF_WEKNORA_START_STRATEGY:-compose-up}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing dependency: $1" >&2
    exit 1
  fi
}

check_registry_connectivity() {
  if [[ "$REGISTRY_CHECK_ENABLED" != "1" ]]; then
    return 0
  fi
  if curl -sS -I -m 12 https://registry-1.docker.io/v2/ >/dev/null 2>&1; then
    return 0
  fi
  echo "[official-weknora] docker registry unreachable: https://registry-1.docker.io/v2/" >&2
  echo "[official-weknora] hint: check network/vpn/firewall or configure Docker registry mirror." >&2
  echo "[official-weknora] hint: set DCF_REGISTRY_CHECK_ENABLED=0 to skip this preflight check." >&2
  return 1
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  if grep -qE "^${key}=" "$file"; then
    sed -i.bak "s#^${key}=.*#${key}=${value}#g" "$file"
    rm -f "${file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

require_cmd docker
require_cmd curl
check_registry_connectivity

if [[ ! -d "$WEKNORA_DIR" ]]; then
  echo "official WeKnora repo not found: $WEKNORA_DIR"
  echo "clone first: git clone https://github.com/Tencent/WeKnora.git $WEKNORA_DIR"
  exit 1
fi

if [[ ! -f "$WEKNORA_ENV_FILE" ]]; then
  if [[ ! -f "$WEKNORA_ENV_EXAMPLE" ]]; then
    echo "missing WeKnora env template: $WEKNORA_ENV_EXAMPLE"
    exit 1
  fi
  cp "$WEKNORA_ENV_EXAMPLE" "$WEKNORA_ENV_FILE"
fi

# Keep DCF integration stable on loopback port 19080.
set_env_value "$WEKNORA_ENV_FILE" "FRONTEND_PORT" "$WEKNORA_WEB_PORT"
# Avoid host 8080 conflict on developer machines.
set_env_value "$WEKNORA_ENV_FILE" "APP_PORT" "$WEKNORA_APP_PORT"

inject_frontend_bridge_config() {
  local config_src="$WEKNORA_DIR/frontend/public/config.js"
  if [[ ! -f "$config_src" ]]; then
    echo "[official-weknora] warning: missing frontend config source: $config_src"
    return 0
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx 'WeKnora-frontend'; then
    echo "[official-weknora] warning: frontend container not found, skip config injection"
    return 0
  fi
  docker cp "$config_src" "WeKnora-frontend:/usr/share/nginx/html/config.js"
}

echo "[official-weknora] starting from $WEKNORA_DIR"
attempt=1
while [[ "$attempt" -le "$WEKNORA_START_RETRIES" ]]; do
  echo "[official-weknora] startup attempt ${attempt}/${WEKNORA_START_RETRIES}"
  if (
    cd "$WEKNORA_DIR"
    if [[ "$WEKNORA_START_STRATEGY" = "official-script" ]]; then
      DOCKER_CLIENT_TIMEOUT="$DOCKER_CLIENT_TIMEOUT" COMPOSE_HTTP_TIMEOUT="$COMPOSE_HTTP_TIMEOUT" \
        bash ./scripts/start_all.sh --docker
    else
      DOCKER_CLIENT_TIMEOUT="$DOCKER_CLIENT_TIMEOUT" COMPOSE_HTTP_TIMEOUT="$COMPOSE_HTTP_TIMEOUT" \
        docker compose up -d
    fi
  ) && inject_frontend_bridge_config && [[ -x "$APP_DIR/scripts/check-official-weknora.sh" ]] && \
    WEKNORA_BASE_URL="$WEKNORA_BASE_URL" WEKNORA_WEB_URL="$WEKNORA_WEB_URL" \
    bash "$APP_DIR/scripts/check-official-weknora.sh"; then
    break
  fi
  if [[ "$attempt" -ge "$WEKNORA_START_RETRIES" ]]; then
    echo "[official-weknora] failed after ${WEKNORA_START_RETRIES} attempts"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 5
done

echo "[official-weknora] expected web:  http://127.0.0.1:${WEKNORA_WEB_PORT}"
echo "[official-weknora] expected api:  http://127.0.0.1:${WEKNORA_WEB_PORT}/api/v1"
echo "[official-weknora] logo file:     $WEKNORA_DIR/frontend/src/assets/img/dcf-knowledge.svg"
echo "[official-weknora] brand strings:  $WEKNORA_DIR/frontend/src/i18n/locales/zh-CN.ts"
