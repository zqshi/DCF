#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/zqs/Downloads/project/DCF"
OPENCLAW_DIR="$ROOT/runtime/openclaw"
APP_DIR="$ROOT/app"
OPENCLAW_CONFIG_PATH="$OPENCLAW_DIR/.openclaw-state/dcf-openclaw.json"
OPENCLAW_CAPABILITY_MODE="$(printf '%s' "${DCF_OPENCLAW_CAPABILITY_MODE:-full}" | tr '[:upper:]' '[:lower:]')"
APP_PROCESS_MANAGER="${DCF_APP_PROCESS_MANAGER:-pm2}"
OPENCLAW_PROCESS_MANAGER="${DCF_OPENCLAW_PROCESS_MANAGER:-pm2}"
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

as_positive_int() {
  local raw="$1"
  local fallback="$2"
  if [[ "$raw" =~ ^[0-9]+$ ]] && [ "$raw" -gt 0 ]; then
    echo "$raw"
  else
    echo "$fallback"
  fi
}

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

mkdir -p "$OPENCLAW_DIR/logs" "$OPENCLAW_DIR/.openclaw-state" "$APP_DIR/logs"
export DCF_RUNTIME_REQUEST_TIMEOUT_MS="$(as_positive_int "${DCF_RUNTIME_REQUEST_TIMEOUT_MS:-}" 30000)"
export DCF_RUNTIME_MAX_TASK_MS="$(as_positive_int "${DCF_RUNTIME_MAX_TASK_MS:-}" 120000)"
if [ "$DCF_RUNTIME_MAX_TASK_MS" -lt "$DCF_RUNTIME_REQUEST_TIMEOUT_MS" ]; then
  export DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS"
fi
export OPENCLAW_TIMEOUT_MS="$(as_positive_int "${OPENCLAW_TIMEOUT_MS:-}" 15000)"
export OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$(as_positive_int "${OPENCLAW_RUNTIME_POLL_INTERVAL_MS:-}" 500)"
export OPENCLAW_RUNTIME_MAX_POLLS="$(as_positive_int "${OPENCLAW_RUNTIME_MAX_POLLS:-}" 300)"
window_ms=$((OPENCLAW_RUNTIME_POLL_INTERVAL_MS * OPENCLAW_RUNTIME_MAX_POLLS))
required_window_ms=$((DCF_RUNTIME_MAX_TASK_MS + 5000))
if [ "$window_ms" -lt "$required_window_ms" ]; then
  export OPENCLAW_RUNTIME_MAX_POLLS="$(((required_window_ms + OPENCLAW_RUNTIME_POLL_INTERVAL_MS - 1) / OPENCLAW_RUNTIME_POLL_INTERVAL_MS))"
fi
DEFAULT_AGENT_MODEL_REF="$(normalize_model_ref "${DCF_RUNTIME_AGENT_MODEL:-${OPENAI_MODEL:-${LLM_MODEL:-deepseek/deepseek-chat}}}")"
DEFAULT_RESPONSE_MODEL_REF="$(normalize_model_ref "${DCF_RUNTIME_RESPONSE_MODEL:-$DEFAULT_AGENT_MODEL_REF}")"
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
        baseUrl: "${OPENAI_BASE_URL:-https://api.openai.com/v1}",
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

echo "[1/2] Starting OpenClaw gateway on 18789 (dcf-runtime plugin enabled, mode=${OPENCLAW_CAPABILITY_MODE}, skipChannels=${OPENCLAW_SKIP_CHANNELS_VALUE})"
(
  cd "$OPENCLAW_DIR"
  if [ "$OPENCLAW_PROCESS_MANAGER" = "pm2" ] && command -v pm2 >/dev/null 2>&1; then
    PM2_GW_NAME="${DCF_PM2_OPENCLAW_NAME:-openclaw-gateway}"
    pm2 delete "$PM2_GW_NAME" >/dev/null 2>&1 || true
    OPENCLAW_STATE_DIR="$OPENCLAW_DIR/.openclaw-state" \
    OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
    OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}" \
    DCF_RUNTIME_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}" \
    DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}" \
    DCF_RUNTIME_RUN_DELAY_MS="${DCF_RUNTIME_RUN_DELAY_MS:-80}" \
    DCF_RUNTIME_REQUEST_TIMEOUT_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS" \
    DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_MAX_TASK_MS" \
    DCF_RUNTIME_RESPONSE_MODEL="$DEFAULT_RESPONSE_MODEL_REF" \
    DCF_OPENCLAW_GATEWAY_BASE_URL="http://127.0.0.1:18789" \
    OPENCLAW_SKIP_CHANNELS="${OPENCLAW_SKIP_CHANNELS_VALUE}" \
    pm2 start dist/index.js --name "$PM2_GW_NAME" --time --update-env -- \
      gateway --allow-unconfigured --bind loopback --port 18789 >/dev/null
  else
    OPENCLAW_STATE_DIR="$OPENCLAW_DIR/.openclaw-state" \
    OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
    OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}" \
    DCF_RUNTIME_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}" \
    DCF_RUNTIME_ALLOW_FALLBACK="${DCF_RUNTIME_ALLOW_FALLBACK:-0}" \
    DCF_RUNTIME_RUN_DELAY_MS="${DCF_RUNTIME_RUN_DELAY_MS:-80}" \
    DCF_RUNTIME_REQUEST_TIMEOUT_MS="$DCF_RUNTIME_REQUEST_TIMEOUT_MS" \
    DCF_RUNTIME_MAX_TASK_MS="$DCF_RUNTIME_MAX_TASK_MS" \
    DCF_RUNTIME_RESPONSE_MODEL="$DEFAULT_RESPONSE_MODEL_REF" \
    DCF_OPENCLAW_GATEWAY_BASE_URL="http://127.0.0.1:18789" \
    OPENCLAW_SKIP_CHANNELS="${OPENCLAW_SKIP_CHANNELS_VALUE}" \
    nohup node dist/index.js gateway --allow-unconfigured --bind loopback --port 18789 \
      > "$OPENCLAW_DIR/logs/gateway.log" 2>&1 &
  fi
)

echo "[2/2] Starting DCF app on 8092 (direct OpenClaw runtime contract)"
(
  cd "$APP_DIR"
  if [ "$APP_PROCESS_MANAGER" = "pm2" ] && command -v pm2 >/dev/null 2>&1; then
    PM2_APP_NAME="${DCF_PM2_APP_NAME:-dcf-app}"
    pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
    HOST="0.0.0.0" \
    OPENCLAW_BASE_URL="http://127.0.0.1:18789" \
    OPENCLAW_API_KEY="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}" \
    OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
    OPENCLAW_CLI_ENTRY="$OPENCLAW_DIR/openclaw.mjs" \
    OPENCLAW_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}" \
    OPENCLAW_TIMEOUT_MS="$OPENCLAW_TIMEOUT_MS" \
    OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$OPENCLAW_RUNTIME_POLL_INTERVAL_MS" \
    OPENCLAW_RUNTIME_MAX_POLLS="$OPENCLAW_RUNTIME_MAX_POLLS" \
    REQUIRE_LLM_RESPONSE="${REQUIRE_LLM_RESPONSE:-1}" \
    OPENCLAW_RUNTIME_SUBMIT_PATH="/runtime/tasks" \
    OPENCLAW_RUNTIME_STATUS_PATH_PREFIX="/runtime/tasks/" \
    PORT=8092 \
    pm2 start src/server.js --name "$PM2_APP_NAME" --time --update-env >/dev/null
  else
    HOST="0.0.0.0" \
    OPENCLAW_BASE_URL="http://127.0.0.1:18789" \
    OPENCLAW_API_KEY="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}" \
    OPENCLAW_CONFIG_PATH="$OPENCLAW_CONFIG_PATH" \
    OPENCLAW_CLI_ENTRY="$OPENCLAW_DIR/openclaw.mjs" \
    OPENCLAW_CONTRACT_VERSION="${DCF_RUNTIME_CONTRACT_VERSION:-v1}" \
    OPENCLAW_TIMEOUT_MS="$OPENCLAW_TIMEOUT_MS" \
    OPENCLAW_RUNTIME_POLL_INTERVAL_MS="$OPENCLAW_RUNTIME_POLL_INTERVAL_MS" \
    OPENCLAW_RUNTIME_MAX_POLLS="$OPENCLAW_RUNTIME_MAX_POLLS" \
    REQUIRE_LLM_RESPONSE="${REQUIRE_LLM_RESPONSE:-1}" \
    OPENCLAW_RUNTIME_SUBMIT_PATH="/runtime/tasks" \
    OPENCLAW_RUNTIME_STATUS_PATH_PREFIX="/runtime/tasks/" \
    PORT=8092 \
    nohup node src/server.js > "$APP_DIR/logs/dcf.log" 2>&1 &
  fi
)

sleep 2
echo "stack start requested"
echo "- OpenClaw Gateway: http://127.0.0.1:18789"
echo "- Runtime Health:   http://127.0.0.1:18789/runtime/health"
echo "- DCF App:          http://127.0.0.1:8092/front.html"
