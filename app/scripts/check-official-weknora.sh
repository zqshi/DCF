#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEKNORA_DIR="${WEKNORA_DIR:-$APP_DIR/vendor/WeKnora}"
WEKNORA_BASE_URL="${WEKNORA_BASE_URL:-http://127.0.0.1:19080}"
WEKNORA_WEB_URL="${WEKNORA_WEB_URL:-http://127.0.0.1:19080/platform/knowledge-bases}"

if [[ ! -d "$WEKNORA_DIR" ]]; then
  echo "official WeKnora repo not found: $WEKNORA_DIR"
  exit 1
fi

echo "[1/3] WeKnora repo"
echo "ok: $WEKNORA_DIR"

echo "[2/3] WeKnora health"
HEALTH_CODE="$(curl -sS -m 3 -o /tmp/weknora-health.json -w '%{http_code}' "${WEKNORA_BASE_URL%/}/health" || true)"
if [[ "$HEALTH_CODE" != "200" ]]; then
  echo "error: ${WEKNORA_BASE_URL%/}/health -> ${HEALTH_CODE}"
  exit 1
fi
echo "ok: ${WEKNORA_BASE_URL%/}/health (${HEALTH_CODE})"

echo "[3/3] WeKnora web entry"
WEB_CODE="$(curl -sS -m 3 -o /tmp/weknora-web.html -w '%{http_code}' "$WEKNORA_WEB_URL" || true)"
if [[ "$WEB_CODE" != "200" && "$WEB_CODE" != "301" && "$WEB_CODE" != "302" && "$WEB_CODE" != "303" ]]; then
  echo "error: ${WEKNORA_WEB_URL} -> ${WEB_CODE}"
  exit 1
fi
echo "ok: ${WEKNORA_WEB_URL} (${WEB_CODE})"

echo "official WeKnora check: passed"
