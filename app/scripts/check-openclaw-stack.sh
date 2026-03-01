#!/usr/bin/env bash
set -euo pipefail

TOKEN="${OPENCLAW_GATEWAY_TOKEN:-dcf-local-token}"
APP_PORT="${PORT:-${DCF_APP_PORT:-8092}}"
OPENCLAW_BASE_URL="${OPENCLAW_BASE_URL:-http://127.0.0.1:${DCF_OPENCLAW_PORT:-18789}}"

echo "[1/3] OpenClaw gateway"
curl -sS -m 3 "${OPENCLAW_BASE_URL%/}/" >/dev/null
echo "ok: ${OPENCLAW_BASE_URL%/}/"

echo "[2/3] OpenClaw runtime contract"
curl -sS -m 3 -H "Authorization: Bearer ${TOKEN}" "${OPENCLAW_BASE_URL%/}/runtime/health"
echo

echo "[3/3] DCF app public endpoints"
DCF_HEALTH_CODE="$(curl -sS -m 3 -o /tmp/dcf-health.json -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/api/health")"
DCF_FRONT_CODE="$(curl -sS -m 3 -o /tmp/dcf-front.html -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/front.html")"
if [[ "$DCF_HEALTH_CODE" != "200" ]]; then
  echo "error: /api/health returned ${DCF_HEALTH_CODE}"
  exit 1
fi
if [[ "$DCF_FRONT_CODE" != "200" && "$DCF_FRONT_CODE" != "302" ]]; then
  echo "error: /front.html returned ${DCF_FRONT_CODE}"
  exit 1
fi
echo "ok: http://127.0.0.1:${APP_PORT}/api/health (200)"
echo "ok: http://127.0.0.1:${APP_PORT}/front.html (${DCF_FRONT_CODE})"

echo "stack-check: passed"
