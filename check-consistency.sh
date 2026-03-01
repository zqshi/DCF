#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
OPENCLAW_DIR="$ROOT_DIR/runtime/openclaw"

PASS=0; FAIL=0; WARN=0
pass() { PASS=$((PASS + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  \033[31m✗\033[0m %s\n' "$1"; }
warn() { WARN=$((WARN + 1)); printf '  \033[33m⚠\033[0m %s\n' "$1"; }
section() { echo ""; printf '\033[1m[%s]\033[0m\n' "$1"; }

env_val() {
  [ -f "$1" ] || return 0
  awk -F= -v k="$2" '$1==k{print substr($0,index($0,"=")+1); exit}' "$1" | tr -d '"' | tr -d "'"
}

json_str() {
  grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null | head -1 | sed 's/.*: *"//' | sed 's/"$//' || true
}

APP_ENV="$APP_DIR/.env"
OC_CONFIG="$OPENCLAW_DIR/.openclaw-state/dcf-openclaw.json"
TOKEN="$(env_val "$APP_ENV" "OPENCLAW_GATEWAY_TOKEN")"
TOKEN="${TOKEN:-dcf-local-token}"
APP_PORT="$(env_val "$APP_ENV" "PORT")"
APP_PORT="${APP_PORT:-8091}"
OC_PORT="18789"
OC_BASE="http://127.0.0.1:$OC_PORT"
APP_BASE="http://127.0.0.1:$APP_PORT"

echo "=== DCF ↔ OpenClaw 一致性检测 ==="

# ─── 1. 文件与目录 ───
section "1/8 文件与目录结构"
[ -f "$APP_ENV" ] && pass "app/.env" || fail "app/.env 缺失"
[ -f "$APP_DIR/src/server.js" ] && pass "app/src/server.js" || fail "app/src/server.js 缺失"
[ -d "$APP_DIR/node_modules" ] && pass "app/node_modules" || fail "app/node_modules 缺失"
[ -d "$APP_DIR/data" ] && pass "app/data 目录" || fail "app/data 目录缺失"
[ -f "$OPENCLAW_DIR/dist/index.js" ] && pass "openclaw dist" || fail "openclaw dist 缺失"
[ -f "$OPENCLAW_DIR/openclaw.mjs" ] && pass "openclaw CLI 入口" || fail "openclaw CLI 入口缺失"
[ -d "$OPENCLAW_DIR/node_modules" ] && pass "openclaw node_modules" || fail "openclaw node_modules 缺失"
[ -f "$OC_CONFIG" ] && pass "openclaw 配置文件" || fail "openclaw 配置文件缺失"
[ -d "$OPENCLAW_DIR/.openclaw-state" ] && pass ".openclaw-state" || fail ".openclaw-state 缺失"
[ -d "$OPENCLAW_DIR/workspace" ] && pass "openclaw workspace" || fail "openclaw workspace 缺失"

# ─── 2. 环境变量一致性 ───
section "2/8 环境变量一致性"
if [ -f "$APP_ENV" ] && [ -f "$OC_CONFIG" ]; then
  E_KEY="$(env_val "$APP_ENV" "OPENAI_API_KEY")"
  O_KEY="$(json_str "$OC_CONFIG" "apiKey")"
  [ -n "$E_KEY" ] && [ "$E_KEY" = "$O_KEY" ] && pass "OPENAI_API_KEY 一致" || { [ -n "$E_KEY" ] && fail "OPENAI_API_KEY 不一致" || warn "OPENAI_API_KEY 为空"; }

  E_URL="$(env_val "$APP_ENV" "OPENAI_BASE_URL")"
  O_URL="$(json_str "$OC_CONFIG" "baseUrl")"
  [ -n "$E_URL" ] && [ "$E_URL" = "$O_URL" ] && pass "OPENAI_BASE_URL 一致" || { [ -n "$E_URL" ] && fail "OPENAI_BASE_URL 不一致: app=$E_URL ↔ oc=$O_URL" || warn "OPENAI_BASE_URL 为空"; }

  E_MODEL="$(env_val "$APP_ENV" "OPENAI_MODEL")"
  O_PRIMARY="$(json_str "$OC_CONFIG" "primary")"
  O_MODEL="${O_PRIMARY##*/}"
  [ -n "$E_MODEL" ] && [ "$E_MODEL" = "$O_MODEL" ] && pass "OPENAI_MODEL 一致: $E_MODEL" || { [ -n "$E_MODEL" ] && fail "OPENAI_MODEL 不一致: app=$E_MODEL ↔ oc=$O_PRIMARY" || warn "OPENAI_MODEL 为空"; }

  E_ENGINE="$(env_val "$APP_ENV" "EXECUTION_ENGINE")"
  [ "$E_ENGINE" = "openclaw" ] && pass "EXECUTION_ENGINE=openclaw" || fail "EXECUTION_ENGINE=$E_ENGINE"

  E_MODE="$(env_val "$APP_ENV" "OPENCLAW_EXECUTION_MODE")"
  [ "$E_MODE" = "runtime" ] && pass "EXECUTION_MODE=runtime" || fail "EXECUTION_MODE=$E_MODE"

  E_GW="$(env_val "$APP_ENV" "OPENCLAW_GATEWAY_TOKEN")"
  E_AK="$(env_val "$APP_ENV" "OPENCLAW_API_KEY")"
  [ -n "$E_GW" ] && [ "$E_GW" = "$E_AK" ] && pass "GATEWAY_TOKEN = API_KEY" || warn "GATEWAY_TOKEN ≠ API_KEY"

  grep -q '"dcf-runtime"' "$OC_CONFIG" 2>/dev/null && pass "dcf-runtime 插件已启用" || fail "dcf-runtime 插件未启用"
  grep -q '"responses"' "$OC_CONFIG" 2>/dev/null && pass "responses 端点已启用" || fail "responses 端点未启用"
else
  fail "缺少 app/.env 或 openclaw 配置文件，跳过变量比较"
fi

# ─── 3. 进程与端口 ───
section "3/8 进程与端口"
lsof -nP -tiTCP:"$OC_PORT" -sTCP:LISTEN >/dev/null 2>&1 && pass "OpenClaw :$OC_PORT 监听中" || fail "OpenClaw :$OC_PORT 未监听"
lsof -nP -tiTCP:"$APP_PORT" -sTCP:LISTEN >/dev/null 2>&1 && pass "DCF app :$APP_PORT 监听中" || fail "DCF app :$APP_PORT 未监听"

if command -v pm2 >/dev/null 2>&1; then
  PM2_JSON="$(pm2 jlist 2>/dev/null || echo "[]")"
  for svc in openclaw-gateway dcf-app; do
    SVC_STATUS="$(echo "$PM2_JSON" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const p=d.find(x=>x.name==='$svc');console.log(p?p.pm2_env.status:'missing')}catch{console.log('error')}" 2>/dev/null)"
    [ "$SVC_STATUS" = "online" ] && pass "pm2 $svc: online" || fail "pm2 $svc: $SVC_STATUS"
  done
  APP_RESTARTS="$(echo "$PM2_JSON" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const p=d.find(x=>x.name==='dcf-app');console.log(p?p.pm2_env.restart_time:'-1')}catch{console.log('-1')}" 2>/dev/null)"
  [ "$APP_RESTARTS" = "0" ] && pass "dcf-app 重启次数: 0" || warn "dcf-app 重启次数: $APP_RESTARTS"
fi

# ─── 4. HTTP 端点连通性 ───
section "4/8 HTTP 端点连通性"

http_code() { curl -sS -o /dev/null -w '%{http_code}' -m 5 -H "Authorization: Bearer $TOKEN" "$1" 2>/dev/null || echo "000"; }
http_body() { curl -sS -m 5 -H "Authorization: Bearer $TOKEN" "$1" 2>/dev/null || echo ""; }

# OpenClaw 端点
OC_ROOT_CODE="$(http_code "$OC_BASE/")"
[ "$OC_ROOT_CODE" = "200" ] && pass "OpenClaw 根路径 (200)" || fail "OpenClaw 根路径 ($OC_ROOT_CODE)"

HEALTH_BODY="$(http_body "$OC_BASE/runtime/health")"
if echo "$HEALTH_BODY" | grep -q '"ok":true' 2>/dev/null; then
  pass "OpenClaw /runtime/health ok"
  # 检查 runtime plugin service 名
  if echo "$HEALTH_BODY" | grep -q '"service"' 2>/dev/null; then
    pass "runtime health 包含 service 字段"
  else
    warn "runtime health 缺少 service 字段"
  fi
else
  fail "OpenClaw /runtime/health 异常: $HEALTH_BODY"
fi

SUBMIT_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' "$OC_BASE/runtime/tasks" 2>/dev/null || echo "000")"
if [ "$SUBMIT_CODE" != "000" ] && [ "$SUBMIT_CODE" != "404" ]; then
  pass "OpenClaw /runtime/tasks 端点可达 ($SUBMIT_CODE)"
else
  fail "OpenClaw /runtime/tasks 端点不可达 ($SUBMIT_CODE)"
fi

RESP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -m 5 -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' "$OC_BASE/v1/responses" 2>/dev/null || echo "000")"
if [ "$RESP_CODE" != "000" ] && [ "$RESP_CODE" != "404" ]; then
  pass "OpenClaw /v1/responses 端点可达 ($RESP_CODE)"
else
  fail "OpenClaw /v1/responses 端点不可达 ($RESP_CODE)"
fi

# DCF App 端点
APP_HEALTH="$(http_body "$APP_BASE/api/health")"
if echo "$APP_HEALTH" | grep -q '"ok":true' 2>/dev/null; then
  pass "DCF /api/health ok"
  if echo "$APP_HEALTH" | grep -q '"runtimeEnabled":true' 2>/dev/null; then
    pass "DCF runtimeEnabled=true"
  else
    fail "DCF runtimeEnabled 不为 true"
  fi
else
  fail "DCF /api/health 异常"
fi

FRONT_CODE="$(http_code "$APP_BASE/front.html")"
[ "$FRONT_CODE" = "200" ] && pass "DCF /front.html (200)" || fail "DCF /front.html ($FRONT_CODE)"

ADMIN_CODE="$(http_code "$APP_BASE/admin/index.html")"
[ "$ADMIN_CODE" = "200" ] && pass "DCF /admin/index.html (200)" || fail "DCF /admin/index.html ($ADMIN_CODE)"
