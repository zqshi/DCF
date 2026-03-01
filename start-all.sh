#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
OPENCLAW_DIR="$ROOT_DIR/runtime/openclaw"
RUN_DIR="$ROOT_DIR/.run"
mkdir -p "$RUN_DIR"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: missing required command: $cmd"
    exit 1
  fi
}

install_deps_if_needed() {
  local dir="$1"
  local marker="$2"
  local install_cmd="$3"
  local label="$4"
  if [ -d "$dir/$marker" ] && [ "${DCF_FORCE_INSTALL_DEPS:-0}" != "1" ]; then
    return 0
  fi
  if [ "${DCF_AUTO_INSTALL_DEPS:-1}" != "1" ]; then
    echo "error: ${label} deps missing (${dir}/${marker}). Set DCF_AUTO_INSTALL_DEPS=1 or run: ${install_cmd}"
    exit 1
  fi
  echo "[deps] installing ${label} dependencies (${install_cmd})"
  (
    cd "$dir"
    if [ "$install_cmd" = "npm install" ]; then
      npm install
    elif [ "$install_cmd" = "pnpm install" ]; then
      pnpm install
    else
      echo "error: unsupported install command: $install_cmd"
      exit 1
    fi
  )
}

is_port_listening() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

is_http_up() {
  local url="$1"
  curl -sS -m 2 "$url" >/dev/null 2>&1
}

wait_for_service() {
  local label="$1"
  local url="$2"
  local max_tries="${3:-30}"
  local delay="${4:-1}"
  local i
  echo "[wait] waiting for ${label} at ${url}"
  for i in $(seq 1 "$max_tries"); do
    if curl -sS -m 2 "$url" >/dev/null 2>&1; then
      echo "[wait] ${label} ready (${i}/${max_tries})"
      return 0
    fi
    sleep "$delay"
  done
  echo "[wait] ${label} not ready after ${max_tries} attempts"
  return 1
}

pick_free_port() {
  local start_port="$1"
  local max_tries="${2:-12}"
  local candidate="$start_port"
  local i=0
  while [ "$i" -lt "$max_tries" ]; do
    if ! is_port_listening "$candidate"; then
      echo "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
    i=$((i + 1))
  done
  return 1
}

load_env_no_override() {
  local file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [[ "$line" != *=* ]]; then
      continue
    fi
    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -n "$key" ] || continue
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < "$file"
}

pick_default_app_env() {
  if [ "${DCF_ENV_PROFILE:-local}" = "production" ]; then
    if [ -f "$APP_DIR/.env.production.local" ]; then
      echo "$APP_DIR/.env.production.local"
      return
    fi
    echo "$APP_DIR/.env.production.example"
    return
  fi
  if [ -f "$APP_DIR/.env" ]; then
    echo "$APP_DIR/.env"
    return
  fi
  echo "$APP_DIR/.env.example"
}

APP_ENV_FILE="${DCF_APP_ENV_FILE:-$(pick_default_app_env)}"
POLICY_ENV_FILE="${DCF_POLICY_ENV_FILE:-}"
if [ -z "$POLICY_ENV_FILE" ]; then
  if [ "${DCF_ENV_PROFILE:-local}" = "production" ]; then
    POLICY_ENV_FILE="$APP_DIR/config/runtime-permission.production.env.example"
  else
    POLICY_ENV_FILE="$APP_DIR/config/runtime-permission.env.example"
  fi
fi

load_env_no_override "$APP_ENV_FILE"
load_env_no_override "$POLICY_ENV_FILE"

normalize_model_ref() {
  local raw="$1"
  local trimmed="${raw#"${raw%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  if [ -z "$trimmed" ]; then
    echo ""
    return 0
  fi
  if [[ "$trimmed" == */* ]]; then
    echo "$trimmed"
    return 0
  fi
  echo "openai/$trimmed"
}

normalize_openai_base_url() {
  local raw="$1"
  local trimmed="${raw#"${raw%%[![:space:]]*}"}"
  trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
  if [ -z "$trimmed" ]; then
    echo "https://api.openai.com/v1"
    return 0
  fi
  if [[ "$trimmed" =~ /v[0-9]+$ ]]; then
    echo "$trimmed"
    return 0
  fi
  if [[ "$trimmed" == "https://api.openai.com" || "$trimmed" == "http://api.openai.com" ]]; then
    echo "$trimmed/v1"
    return 0
  fi
  if [[ "$trimmed" =~ /compatible-mode/?$ ]]; then
    echo "${trimmed%/}/v1"
    return 0
  fi
  echo "$trimmed"
}

require_cmd node
require_cmd npm
require_cmd pnpm

# --- Phase 0.0: OpenClaw multi-instance isolation ---
# Force OPENCLAW_STATE_DIR to project-local directory
OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-$OPENCLAW_DIR/.openclaw-state}"
if [ "$OPENCLAW_STATE_DIR" = "$HOME/.openclaw" ]; then
  echo "[isolation] WARNING: OPENCLAW_STATE_DIR points to global ~/.openclaw, overriding to project-local"
  OPENCLAW_STATE_DIR="$OPENCLAW_DIR/.openclaw-state"
fi
export OPENCLAW_STATE_DIR
mkdir -p "$OPENCLAW_STATE_DIR"
echo "[isolation] OPENCLAW_STATE_DIR=$OPENCLAW_STATE_DIR"

install_deps_if_needed "$APP_DIR" "node_modules" "npm install" "app"
install_deps_if_needed "$OPENCLAW_DIR" "node_modules" "pnpm install" "openclaw"
APP_PROCESS_MANAGER="${DCF_APP_PROCESS_MANAGER:-pm2}"
OPENCLAW_PROCESS_MANAGER="${DCF_OPENCLAW_PROCESS_MANAGER:-pm2}"

as_positive_int() {
  local raw="$1"
  local fallback="$2"
  if [[ "$raw" =~ ^[0-9]+$ ]] && [ "$raw" -gt 0 ]; then
    echo "$raw"
  else
    echo "$fallback"
  fi
}

APP_PORT="${PORT:-${DCF_APP_PORT:-8092}}"
export PORT="$APP_PORT"
export HOST="${HOST:-0.0.0.0}"
export EXECUTION_ENGINE="${EXECUTION_ENGINE:-openclaw}"
export OPENCLAW_RUNTIME_SUBMIT_PATH="${OPENCLAW_RUNTIME_SUBMIT_PATH:-/runtime/tasks}"
export OPENCLAW_RUNTIME_STATUS_PATH_PREFIX="${OPENCLAW_RUNTIME_STATUS_PATH_PREFIX:-/runtime/tasks/}"
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}"
export OPENCLAW_API_KEY="${OPENCLAW_API_KEY:-$OPENCLAW_GATEWAY_TOKEN}"
export OPENCLAW_REQUIRE_AUTH="${OPENCLAW_REQUIRE_AUTH:-0}"
export DCF_RUNTIME_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}"
export DCF_RUNTIME_REQUEST_TIMEOUT_MS="$(as_positive_int "${DCF_RUNTIME_REQUEST_TIMEOUT_MS:-}" 30000)"
export DCF_RUNTIME_MAX_TASK_MS="$(as_positive_int "${DCF_RUNTIME_MAX_TASK_MS:-}" 120000)"
if [ "$DCF_RUNTIME_MAX_TASK_MS" -lt "$DCF_RUNTIME_REQUEST_TIMEOUT_MS" ]; then
  export DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS"
fi
export OPENCLAW_TIMEOUT_MS="$(as_positive_int "${OPENCLAW_TIMEOUT_MS:-}" 15000)"
export OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$(as_positive_int "${OPENCLAW_RUNTIME_POLL_INTERVAL_MS:-}" 500)"
export OPENCLAW_RUNTIME_MAX_POLLS="$(as_positive_int "${OPENCLAW_RUNTIME_MAX_POLLS:-}" 300)"
local_window_ms=$((OPENCLAW_RUNTIME_POLL_INTERVAL_MS * OPENCLAW_RUNTIME_MAX_POLLS))
required_window_ms=$((DCF_RUNTIME_MAX_TASK_MS + 5000))
if [ "$local_window_ms" -lt "$required_window_ms" ]; then
  export OPENCLAW_RUNTIME_MAX_POLLS="$(((required_window_ms + OPENCLAW_RUNTIME_POLL_INTERVAL_MS - 1) / OPENCLAW_RUNTIME_POLL_INTERVAL_MS))"
fi
START_LOCAL_OPENCLAW="${DCF_START_LOCAL_OPENCLAW:-1}"
OPENCLAW_CAPABILITY_MODE="$(printf '%s' "${DCF_OPENCLAW_CAPABILITY_MODE:-full}" | tr '[:upper:]' '[:lower:]')"
if [ "$OPENCLAW_CAPABILITY_MODE" != "runtime" ] && [ "$OPENCLAW_CAPABILITY_MODE" != "full" ]; then
  echo "error: unsupported DCF_OPENCLAW_CAPABILITY_MODE=${OPENCLAW_CAPABILITY_MODE} (expected runtime|full)"
  exit 1
fi
if [ "$OPENCLAW_CAPABILITY_MODE" = "full" ]; then
  OPENCLAW_CONTROL_UI_ENABLED="${OPENCLAW_CONTROL_UI_ENABLED:-true}"
  OPENCLAW_SKIP_CHANNELS_VALUE="${OPENCLAW_SKIP_CHANNELS:-0}"
  if [ "${DCF_OPENCLAW_FORCE_UNRESTRICTED:-1}" = "1" ]; then
    export OPENCLAW_ALLOWED_HOSTS="*"
    export OPENCLAW_ALLOWED_TOOLS="bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp"
    export OPENCLAW_DENIED_TOOLS=""
    export OPENCLAW_DEFAULT_TOOL_SCOPE="bash,read,write,search,test,browser,cron,nodes,canvas,gateway,discord,slack,telegram,whatsapp"
  fi
else
  OPENCLAW_CONTROL_UI_ENABLED="${OPENCLAW_CONTROL_UI_ENABLED:-false}"
  OPENCLAW_SKIP_CHANNELS_VALUE="${OPENCLAW_SKIP_CHANNELS:-1}"
fi

GATEWAY_PORT="${DCF_OPENCLAW_PORT:-18789}"
if [ "$START_LOCAL_OPENCLAW" = "1" ]; then
  export OPENCLAW_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}"
else
  export OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:${GATEWAY_PORT}}"
fi

if [ "$START_LOCAL_OPENCLAW" = "1" ] && is_port_listening "$GATEWAY_PORT"; then
  GATEWAY_ROOT_URL="http://127.0.0.1:${GATEWAY_PORT}/"
  if [ "${DCF_REUSE_EXISTING_OPENCLAW:-0}" = "1" ]; then
    if is_http_up "$GATEWAY_ROOT_URL"; then
      echo "[start] reuse existing gateway on :${GATEWAY_PORT}"
      START_LOCAL_OPENCLAW=0
    else
      if [ "${DCF_AUTO_REMAP_OPENCLAW_PORT:-1}" = "1" ]; then
        NEXT_PORT="$(pick_free_port "$((GATEWAY_PORT + 1))" 20 || true)"
        if [ -z "${NEXT_PORT:-}" ]; then
          echo "error: gateway port ${GATEWAY_PORT} is occupied and no free fallback port found"
          exit 1
        fi
        GATEWAY_PORT="$NEXT_PORT"
        export OPENCLAW_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}"
        echo "[start] gateway port ${DCF_OPENCLAW_PORT:-18789} occupied but unhealthy; remap to :${GATEWAY_PORT}"
      else
        echo "error: gateway port ${GATEWAY_PORT} is occupied but service is unhealthy"
        echo "hint: set DCF_AUTO_REMAP_OPENCLAW_PORT=1 or free the port"
        exit 1
      fi
    fi
  else
    echo "error: gateway port ${GATEWAY_PORT} is already in use"
    echo "hint: set DCF_REUSE_EXISTING_OPENCLAW=1 or change DCF_OPENCLAW_PORT"
    echo "[diag] port ${GATEWAY_PORT} occupied by:"
    lsof -nP -i TCP:"$GATEWAY_PORT" -sTCP:LISTEN 2>/dev/null || true
    exit 1
  fi
fi

echo "[config] app env: $APP_ENV_FILE"
echo "[config] policy env: $POLICY_ENV_FILE"
echo "[config] gateway: $OPENCLAW_BASE_URL"
echo "[config] app: http://127.0.0.1:${APP_PORT}"
echo "[config] runtime timeout: request=${DCF_RUNTIME_REQUEST_TIMEOUT_MS}ms max_task=${DCF_RUNTIME_MAX_TASK_MS}ms"
echo "[config] app poll window: timeout=${OPENCLAW_TIMEOUT_MS}ms interval=${OPENCLAW_RUNTIME_POLL_INTERVAL_MS}ms polls=${OPENCLAW_RUNTIME_MAX_POLLS}"
echo "[config] openclaw capability mode: ${OPENCLAW_CAPABILITY_MODE}"
echo "[config] openclaw skip channels: ${OPENCLAW_SKIP_CHANNELS_VALUE}"
echo "[config] openclaw allowed hosts: ${OPENCLAW_ALLOWED_HOSTS:-}"
echo "[config] openclaw allowed tools: ${OPENCLAW_ALLOWED_TOOLS:-}"
echo "[config] openclaw denied tools: ${OPENCLAW_DENIED_TOOLS:-}"

if [ ! -f "$OPENCLAW_DIR/dist/index.js" ]; then
  if [ "${DCF_BUILD_OPENCLAW_IF_MISSING:-1}" != "0" ]; then
    echo "[build] OpenClaw dist missing, building..."
    if command -v pnpm >/dev/null 2>&1; then
      (
        cd "$OPENCLAW_DIR"
        pnpm build
      )
    else
      echo "error: pnpm is required to build runtime/openclaw (dist/index.js missing)"
      exit 1
    fi
  else
    echo "error: OpenClaw dist missing and DCF_BUILD_OPENCLAW_IF_MISSING=0"
    exit 1
  fi
fi

if [ "${DCF_USE_LOCAL_DOCKER_DEPS:-1}" = "1" ]; then
  if [ -x "$APP_DIR/scripts/start-local-docker-stack.sh" ]; then
    echo "[deps] starting local docker dependencies"
    if ! bash "$APP_DIR/scripts/start-local-docker-stack.sh"; then
      if [ "${DCF_DOCKER_DEPS_REQUIRED:-0}" = "1" ]; then
        echo "error: local docker dependencies failed and DCF_DOCKER_DEPS_REQUIRED=1"
        exit 1
      fi
      echo "[deps] warning: local docker dependencies failed, continuing without them"
    fi
  else
    if [ "${DCF_DOCKER_DEPS_REQUIRED:-0}" = "1" ]; then
      echo "error: docker dependency script not found: $APP_DIR/scripts/start-local-docker-stack.sh"
      exit 1
    fi
    echo "[deps] warning: docker dependency script not found, continuing without local docker dependencies"
  fi
fi

OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/dcf-openclaw.json"
mkdir -p "$OPENCLAW_STATE_DIR" "$OPENCLAW_DIR/logs" "$APP_DIR/logs"
DEFAULT_AGENT_MODEL_REF="$(normalize_model_ref "${DCF_RUNTIME_AGENT_MODEL:-${OPENAI_MODEL:-${LLM_MODEL:-deepseek/deepseek-chat}}}")"
DEFAULT_RESPONSE_MODEL_REF="$(normalize_model_ref "${DCF_RUNTIME_RESPONSE_MODEL:-$DEFAULT_AGENT_MODEL_REF}")"
NORMALIZED_OPENAI_BASE_URL="$(normalize_openai_base_url "${OPENAI_BASE_URL:-}")"
cat > "$OPENCLAW_CONFIG_PATH" <<EOF
{
  gateway: {
    controlUi: {
      enabled: ${OPENCLAW_CONTROL_UI_ENABLED}
    },
    http: {
      endpoints: {
        responses: { enabled: true }
      }
    }
  },
  agents: {
    defaults: {
      model: {
        primary: "${DEFAULT_AGENT_MODEL_REF}"
      },
      models: {
        "${DEFAULT_AGENT_MODEL_REF}": {},
        "openai/gpt-4.1-mini": {
          alias: "gpt-mini"
        }
      }
    }
  },
  models: {
    providers: {
      openai: {
        baseUrl: "${NORMALIZED_OPENAI_BASE_URL}",
        apiKey: "${OPENAI_API_KEY:-}",
        api: "openai-completions",
        models: [
          {
            id: "${OPENAI_MODEL:-qwen-plus}",
            name: "${OPENAI_MODEL:-qwen-plus}",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 8192
          },
          {
            id: "gpt-4.1-mini",
            name: "gpt-4.1-mini",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 131072,
            maxTokens: 8192
          }
        ]
      }
    }
  },
  plugins: {
    entries: {
      "dcf-runtime": {
        enabled: true
      }
    }
  }
}
EOF

# --- Phase 0.0: PID file validation ---
# Validate stale PID files before stop-all to avoid misidentifying processes
for pidfile in "$RUN_DIR/openclaw.pid" "$RUN_DIR/dcf-app.pid"; do
  if [ -f "$pidfile" ]; then
    OLD_PID="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ]; then
      if ! kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[pid] stale PID file $pidfile (pid=$OLD_PID not running), removing"
        rm -f "$pidfile"
      fi
    fi
  fi
done

echo "[stop] cleaning old processes"
bash "$ROOT_DIR/stop-all.sh" >/dev/null 2>&1 || true

STARTED_STACK=0
rollback_on_error() {
  if [ "$STARTED_STACK" = "1" ] && [ "${DCF_ROLLBACK_ON_FAILURE:-1}" = "1" ]; then
    echo "[rollback] startup failed, stopping partial stack"
    bash "$ROOT_DIR/stop-all.sh" >/dev/null 2>&1 || true
  fi
}
trap rollback_on_error ERR

if [ "$START_LOCAL_OPENCLAW" = "1" ]; then
  echo "[start] OpenClaw gateway :${GATEWAY_PORT}"
  (
    cd "$OPENCLAW_DIR"
    if [ "$OPENCLAW_PROCESS_MANAGER" = "pm2" ] && command -v pm2 >/dev/null 2>&1; then
      PM2_GW_NAME="${DCF_PM2_OPENCLAW_NAME:-openclaw-gateway}"
      pm2 delete "$PM2_GW_NAME" >/dev/null 2>&1 || true
      OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR" \
      OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
      OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
      DCF_RUNTIME_CONTRACT_VERSION="$DCF_RUNTIME_CONTRACT_VERSION" \
      DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}" \
      DCF_RUNTIME_RUN_DELAY_MS="${DCF_RUNTIME_RUN_DELAY_MS:-80}" \
      DCF_RUNTIME_REQUEST_TIMEOUT_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS" \
      DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_MAX_TASK_MS" \
      DCF_RUNTIME_RESPONSE_MODEL="$DEFAULT_RESPONSE_MODEL_REF" \
      DCF_OPENCLAW_GATEWAY_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}" \
      OPENCLAW_SKIP_CHANNELS="$OPENCLAW_SKIP_CHANNELS_VALUE" \
      pm2 start dist/index.js --name "$PM2_GW_NAME" --time --update-env -- \
        gateway --allow-unconfigured --bind loopback --port "$GATEWAY_PORT" >/dev/null
      PM2_GW_PID="$(pm2 pid "$PM2_GW_NAME" | awk 'NF{print; exit}' || true)"
      if [ -n "$PM2_GW_PID" ] && [ "$PM2_GW_PID" != "0" ]; then
        echo "$PM2_GW_PID" > "$RUN_DIR/openclaw.pid"
      fi
    else
      OPENCLAW_STATE_DIR="$OPENCLAW_STATE_DIR" \
      OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
      OPENCLAW_GATEWAY_TOKEN="$OPENCLAW_GATEWAY_TOKEN" \
      DCF_RUNTIME_CONTRACT_VERSION="$DCF_RUNTIME_CONTRACT_VERSION" \
      DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}" \
      DCF_RUNTIME_RUN_DELAY_MS="${DCF_RUNTIME_RUN_DELAY_MS:-80}" \
      DCF_RUNTIME_REQUEST_TIMEOUT_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS" \
      DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_MAX_TASK_MS" \
      DCF_RUNTIME_RESPONSE_MODEL="$DEFAULT_RESPONSE_MODEL_REF" \
      DCF_OPENCLAW_GATEWAY_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}" \
      OPENCLAW_SKIP_CHANNELS="$OPENCLAW_SKIP_CHANNELS_VALUE" \
      nohup node dist/index.js gateway --allow-unconfigured --bind loopback --port "$GATEWAY_PORT" \
        > "$OPENCLAW_DIR/logs/gateway.log" 2>&1 &
      echo $! > "$RUN_DIR/openclaw.pid"
    fi
  )
  STARTED_STACK=1
  wait_for_service "OpenClaw gateway" "http://127.0.0.1:${GATEWAY_PORT}/" 30 1
else
  echo "[start] skip local OpenClaw gateway (DCF_START_LOCAL_OPENCLAW=0 or reused existing)"
fi

if is_port_listening "$APP_PORT"; then
  if [ "${DCF_REUSE_EXISTING_APP:-0}" = "1" ]; then
    echo "[start] reuse existing DCF app on :${APP_PORT}"
  else
    echo "error: app port ${APP_PORT} is already in use"
    echo "hint: run ./stop-all.sh or set DCF_REUSE_EXISTING_APP=1"
    exit 1
  fi
else
  echo "[start] DCF app :${APP_PORT}"
  (
    cd "$APP_DIR"
    if [ "$APP_PROCESS_MANAGER" = "pm2" ] && command -v pm2 >/dev/null 2>&1; then
      PM2_NAME="${DCF_PM2_APP_NAME:-dcf-app}"
      pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
      if [ -f "$ROOT_DIR/ecosystem.config.js" ]; then
        PORT="$APP_PORT" \
        HOST="$HOST" \
        OPENCLAW_TIMEOUT_MS="$OPENCLAW_TIMEOUT_MS" \
        OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$OPENCLAW_RUNTIME_POLL_INTERVAL_MS" \
        OPENCLAW_RUNTIME_MAX_POLLS="$OPENCLAW_RUNTIME_MAX_POLLS" \
        OPENCLAW_CLI_ENTRY="${OPENCLAW_CLI_ENTRY:-$OPENCLAW_DIR/openclaw.mjs}" \
        pm2 start "$ROOT_DIR/ecosystem.config.js" --update-env >/dev/null
      else
        PORT="$APP_PORT" \
        HOST="$HOST" \
        OPENCLAW_TIMEOUT_MS="$OPENCLAW_TIMEOUT_MS" \
        OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$OPENCLAW_RUNTIME_POLL_INTERVAL_MS" \
        OPENCLAW_RUNTIME_MAX_POLLS="$OPENCLAW_RUNTIME_MAX_POLLS" \
        OPENCLAW_CLI_ENTRY="${OPENCLAW_CLI_ENTRY:-$OPENCLAW_DIR/openclaw.mjs}" \
        pm2 start src/server.js --name "$PM2_NAME" --time --update-env >/dev/null
      fi
      PM2_PID="$(pm2 pid "$PM2_NAME" | awk 'NF{print; exit}' || true)"
      if [ -n "$PM2_PID" ] && [ "$PM2_PID" != "0" ]; then
        echo "$PM2_PID" > "$RUN_DIR/dcf-app.pid"
      fi
    else
      PORT="$APP_PORT" \
      HOST="$HOST" \
      OPENCLAW_TIMEOUT_MS="$OPENCLAW_TIMEOUT_MS" \
      OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$OPENCLAW_RUNTIME_POLL_INTERVAL_MS" \
      OPENCLAW_RUNTIME_MAX_POLLS="$OPENCLAW_RUNTIME_MAX_POLLS" \
      OPENCLAW_CLI_ENTRY="${OPENCLAW_CLI_ENTRY:-$OPENCLAW_DIR/openclaw.mjs}" \
      nohup node src/server.js > "$APP_DIR/logs/dcf.log" 2>&1 &
      echo $! > "$RUN_DIR/dcf-app.pid"
    fi
  )
  STARTED_STACK=1
fi

wait_for_service "DCF app" "http://127.0.0.1:${APP_PORT}/api/health" 60 1

if [ "${DCF_POLICY_AUTO_APPLY:-0}" = "1" ]; then
  if [ -n "${DCF_ADMIN_USERNAME:-}" ] && [ -n "${DCF_ADMIN_PASSWORD:-}" ]; then
    echo "[policy] applying runtime permission baseline"
    (
      cd "$APP_DIR"
      DCF_BASE_URL="http://127.0.0.1:${APP_PORT}" \
      DCF_DRY_RUN="${DCF_POLICY_DRY_RUN:-0}" \
      DCF_APPLY_JOB_POLICY="${DCF_APPLY_JOB_POLICY:-1}" \
      DCF_POLICY_FILE="${DCF_POLICY_FILE:-./config/runtime-permission-policy.example.json}" \
      DCF_ADMIN_USERNAME="$DCF_ADMIN_USERNAME" \
      DCF_ADMIN_PASSWORD="$DCF_ADMIN_PASSWORD" \
      node scripts/apply-runtime-permission-baseline.js || true
    )
  else
    echo "[policy] skip: set DCF_ADMIN_USERNAME/DCF_ADMIN_PASSWORD to auto-apply baseline"
  fi
fi

printf '%s\n' "$APP_PORT" > "$RUN_DIR/app.port"
printf '%s\n' "$OPENCLAW_BASE_URL" > "$RUN_DIR/openclaw.base_url"

echo "[check] running stack check"
if bash "$ROOT_DIR/check-all.sh"; then
  echo "[check] stack check passed"
else
  echo "[check] warning: stack check reported issues (services may still be starting)"
fi
trap - ERR

echo "ready:"
echo "- Front:  http://127.0.0.1:${APP_PORT}/front.html"
echo "- Admin:  http://127.0.0.1:${APP_PORT}/admin/index.html"
echo "- Health: http://127.0.0.1:${APP_PORT}/api/health"
