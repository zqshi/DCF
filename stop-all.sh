#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT_DIR/.run"
APP_DIR="$ROOT_DIR/app"

collect_port() {
  local candidate="$1"
  if [[ "$candidate" =~ ^[0-9]+$ ]] && [ "$candidate" -gt 0 ] && [ "$candidate" -le 65535 ]; then
    printf '%s\n' "$candidate"
  fi
}

is_owned_process() {
  local pid="$1"
  # Check 1: process cwd is under this project
  local cwd=""
  cwd="$(lsof -d cwd -Fn -p "$pid" 2>/dev/null | awk '/^n/{sub(/^n/,""); print; exit}' || true)"
  [[ -n "$cwd" && "$cwd" == "$ROOT_DIR"* ]] && return 0
  # Check 2: command line references this project dir
  local cmd=""
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  [[ -n "$cmd" && "$cmd" == *"$ROOT_DIR"* ]] && return 0
  return 1
}

kill_node_listener_by_port() {
  local port="$1"
  local pids=""
  pids="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN -c node 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return 0
  fi
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if is_owned_process "$pid"; then
      kill "$pid" 2>/dev/null || true
    fi
  done <<< "$pids"
}

kill_pid_file() {
  local file="$1"
  if [ -f "$file" ]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      kill "$pid" || true
    fi
    rm -f "$file"
  fi
}

echo "[stop] pid files"
kill_pid_file "$RUN_DIR/dcf-app.pid"
kill_pid_file "$RUN_DIR/openclaw.pid"
rm -f "$RUN_DIR/app.port" "$RUN_DIR/openclaw.base_url"

echo "[stop] fallback process match"
if command -v pm2 >/dev/null 2>&1; then
  PM2_NAME="${DCF_PM2_APP_NAME:-dcf-app}"
  PM2_GW_NAME="${DCF_PM2_OPENCLAW_NAME:-openclaw-gateway}"
  pm2 stop "$PM2_GW_NAME" >/dev/null 2>&1 || true
  pm2 delete "$PM2_GW_NAME" >/dev/null 2>&1 || true
  pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true
  pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
fi
# Only kill processes whose command line contains BOTH the pattern AND this project's root dir
for pattern in \
  "node dist/index.js gateway --allow-unconfigured --bind loopback --port" \
  "node src/server.js"; do
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  for pid in $pids; do
    [ -n "$pid" ] || continue
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    cwd="$(lsof -d cwd -Fn -p "$pid" 2>/dev/null | awk '/^n/{sub(/^n/,""); print; exit}' || true)"
    if [[ "$cmd" == *"$ROOT_DIR"* ]] || [[ "$cwd" == "$ROOT_DIR"* ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
done

echo "[stop] node listeners on known app/gateway ports"
KNOWN_PORTS_RAW=""
KNOWN_PORTS_RAW+=$'\n'"8080"
KNOWN_PORTS_RAW+=$'\n'"8091"
KNOWN_PORTS_RAW+=$'\n'"8092"
KNOWN_PORTS_RAW+=$'\n'"18789"
if [ -f "$RUN_DIR/app.port" ]; then
  KNOWN_PORTS_RAW+=$'\n'"$(cat "$RUN_DIR/app.port" 2>/dev/null || true)"
fi
if [ -f "$APP_DIR/.env" ]; then
  APP_ENV_PORT="$(awk -F= '/^PORT=/{print $2}' "$APP_DIR/.env" | tail -n1 | tr -d '[:space:]' || true)"
  APP_ENV_DCF_PORT="$(awk -F= '/^DCF_APP_PORT=/{print $2}' "$APP_DIR/.env" | tail -n1 | tr -d '[:space:]' || true)"
  APP_ENV_GATEWAY_PORT="$(awk -F= '/^DCF_OPENCLAW_PORT=/{print $2}' "$APP_DIR/.env" | tail -n1 | tr -d '[:space:]' || true)"
  KNOWN_PORTS_RAW+=$'\n'"$APP_ENV_PORT"
  KNOWN_PORTS_RAW+=$'\n'"$APP_ENV_DCF_PORT"
  KNOWN_PORTS_RAW+=$'\n'"$APP_ENV_GATEWAY_PORT"
fi
while IFS= read -r port; do
  port="$(collect_port "$port" || true)"
  [ -n "$port" ] || continue
  kill_node_listener_by_port "$port"
done < <(printf '%s\n' "$KNOWN_PORTS_RAW" | awk 'NF{print}' | sort -u)

echo "[stop] app local stop.sh"
if [ -f "$APP_DIR/stop.sh" ]; then
  bash "$APP_DIR/stop.sh" >/dev/null 2>&1 || true
fi

echo "all stop requested"
