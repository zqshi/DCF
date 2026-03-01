#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"

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
load_env_no_override "$APP_ENV_FILE"
WEKNORA_CHECK_REQUIRED="${DCF_WEKNORA_CHECK_REQUIRED:-0}"

APP_PORT="${PORT:-${DCF_APP_PORT:-8092}}"
if [ -f "$ROOT_DIR/.run/app.port" ]; then
  APP_PORT="$(cat "$ROOT_DIR/.run/app.port")"
fi
TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}"
OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:${DCF_OPENCLAW_PORT:-18789}}"
if [ -f "$ROOT_DIR/.run/openclaw.base_url" ]; then
  OPENCLAW_BASE_URL="$(cat "$ROOT_DIR/.run/openclaw.base_url")"
fi
OPENCLAW_RUNTIME_HEALTH_URL="${OPENCLAW_BASE_URL%/}/runtime/health"
OPENCLAW_ROOT_URL="${OPENCLAW_BASE_URL%/}/"

wait_http_ok() {
  local url="$1"
  local tries="${2:-20}"
  local delay="${3:-0.3}"
  local i
  for i in $(seq 1 "$tries"); do
    if curl -sS -m 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$delay"
  done
  return 1
}

echo "[1/4] OpenClaw gateway root"
wait_http_ok "$OPENCLAW_ROOT_URL" 30 0.3
echo "ok: $OPENCLAW_ROOT_URL"

echo "[2/4] OpenClaw runtime health"
wait_http_ok "$OPENCLAW_RUNTIME_HEALTH_URL" 30 0.3
curl -sS -m 3 -H "Authorization: Bearer ${TOKEN}" "$OPENCLAW_RUNTIME_HEALTH_URL" >/dev/null
echo "ok: $OPENCLAW_RUNTIME_HEALTH_URL"

echo "[3/4] DCF backend health"
BACKEND_CODE="$(curl -sS -m 3 -o /tmp/dcf-health.json -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health")"
if [[ "$BACKEND_CODE" != "200" ]]; then
  echo "error: /api/health returned ${BACKEND_CODE}"
  exit 1
fi
echo "ok: http://127.0.0.1:${APP_PORT}/api/health (200)"

echo "[4/4] DCF frontend routes"
FRONT_CODE="$(curl -sS -m 3 -o /tmp/dcf-front.html -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/front.html")"
ADMIN_CODE="$(curl -sS -m 3 -o /tmp/dcf-admin.html -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/admin/index.html")"
if [[ "$FRONT_CODE" != "200" && "$FRONT_CODE" != "302" ]]; then
  echo "error: /front.html returned ${FRONT_CODE}"
  exit 1
fi
if [[ "$ADMIN_CODE" != "200" && "$ADMIN_CODE" != "302" ]]; then
  echo "error: /admin/index.html returned ${ADMIN_CODE}"
  exit 1
fi
echo "ok: http://127.0.0.1:${APP_PORT}/front.html (${FRONT_CODE})"
echo "ok: http://127.0.0.1:${APP_PORT}/admin/index.html (${ADMIN_CODE})"

if [[ "${FRONT_KNOWLEDGE_ENTRY_ENABLED:-1}" != "0" && "${FRONT_KNOWLEDGE_ENTRY_MODE:-external}" = "external" ]]; then
  echo "[5/6] WeKnora external entry"
  WEKNORA_WEB_URL="${WEKNORA_WEB_URL:-http://127.0.0.1:19080/platform/knowledge-bases}"
  WEKNORA_BASE_URL="${WEKNORA_BASE_URL:-http://127.0.0.1:19080}"
  WEKNORA_HEALTH_CODE="$(curl -sS -m 3 -o /tmp/dcf-weknora-health.json -w '%{http_code}' "${WEKNORA_BASE_URL%/}/health" || true)"
  if [[ "$WEKNORA_HEALTH_CODE" != "200" ]]; then
    if [[ "$WEKNORA_CHECK_REQUIRED" = "1" ]]; then
      echo "error: WeKnora health check failed (${WEKNORA_HEALTH_CODE}) on ${WEKNORA_BASE_URL%/}/health"
      exit 1
    fi
    echo "warn: WeKnora health check failed (${WEKNORA_HEALTH_CODE}) on ${WEKNORA_BASE_URL%/}/health (non-blocking)"
    echo "warn: set DCF_WEKNORA_CHECK_REQUIRED=1 to make this check blocking"
  else
    WEKNORA_WEB_CODE="$(curl -sS -m 3 -o /tmp/dcf-weknora-web.html -w '%{http_code}' "$WEKNORA_WEB_URL" || true)"
    if [[ "$WEKNORA_WEB_CODE" != "200" && "$WEKNORA_WEB_CODE" != "301" && "$WEKNORA_WEB_CODE" != "302" && "$WEKNORA_WEB_CODE" != "303" ]]; then
      if [[ "$WEKNORA_CHECK_REQUIRED" = "1" ]]; then
        echo "error: WeKnora web entry unavailable (${WEKNORA_WEB_CODE}) on ${WEKNORA_WEB_URL}"
        exit 1
      fi
      echo "warn: WeKnora web entry unavailable (${WEKNORA_WEB_CODE}) on ${WEKNORA_WEB_URL} (non-blocking)"
      echo "warn: set DCF_WEKNORA_CHECK_REQUIRED=1 to make this check blocking"
    else
      echo "ok: ${WEKNORA_BASE_URL%/}/health (${WEKNORA_HEALTH_CODE})"
      echo "ok: ${WEKNORA_WEB_URL} (${WEKNORA_WEB_CODE})"
    fi
  fi
else
  echo "[5/6] skip WeKnora external entry check (mode=${FRONT_KNOWLEDGE_ENTRY_MODE:-external}, enabled=${FRONT_KNOWLEDGE_ENTRY_ENABLED:-1})"
fi

if [ "${DCF_RUNTIME_SMOKE_TEST:-0}" = "1" ]; then
  echo "[6/6] Runtime task smoke test"
  node - <<'NODE'
const base = process.env.OPENCLAW_BASE_URL || `http://127.0.0.1:${process.env.DCF_OPENCLAW_PORT || "18789"}`;
const token = process.env.OPENCLAW_GATEWAY_TOKEN || "dcf-local-token";
const headers = {
  "content-type": "application/json",
  authorization: `Bearer ${token}`,
  "x-contract-version": process.env.DCF_RUNTIME_CONTRACT_VERSION || "v1",
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const submit = await fetch(`${base.replace(/\/$/, "")}/runtime/tasks`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      goal: "仅回复: health-ok",
      riskLevel: "L2",
      employeeId: "health-check",
      conversationId: "health-check",
    }),
  });
  if (!submit.ok) {
    throw new Error(`runtime submit failed: ${submit.status}`);
  }
  const body = await submit.json();
  const taskId = body.runtimeTaskId || body.taskId || (body.task && body.task.id);
  if (!taskId) {
    throw new Error("runtime submit returned no task id");
  }
  for (let i = 0; i < 20; i += 1) {
    await delay(500);
    const res = await fetch(`${base.replace(/\/$/, "")}/runtime/tasks/${taskId}`, {
      headers: {
        authorization: `Bearer ${token}`,
        "x-contract-version": process.env.DCF_RUNTIME_CONTRACT_VERSION || "v1",
      },
    });
    if (!res.ok) {
      throw new Error(`runtime status failed: ${res.status}`);
    }
    const task = await res.json();
    const status = task.status || (task.task && task.task.status);
    if (status === "succeeded") {
      console.log("ok: runtime smoke succeeded");
      return;
    }
    if (status === "failed" || status === "aborted") {
      throw new Error(`runtime smoke failed: ${JSON.stringify(task)}`);
    }
  }
  throw new Error("runtime smoke timed out");
})().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
NODE
fi

if [ -f "$APP_DIR/scripts/check-openclaw-stack.sh" ]; then
  echo "[compat] app/scripts/check-openclaw-stack.sh"
  bash "$APP_DIR/scripts/check-openclaw-stack.sh" >/dev/null 2>&1 || true
fi

echo "stack-check: passed"
