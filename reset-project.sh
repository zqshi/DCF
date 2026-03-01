#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
OPENCLAW_DIR="$ROOT_DIR/runtime/openclaw"
LOCAL_DOCKER_DIR="$APP_DIR/docker/local"
OPENCLAW_DOCKER_STATE_DIR="$LOCAL_DOCKER_DIR/openclaw-config"
OPENCLAW_DOCKER_WORKSPACE_DIR="$LOCAL_DOCKER_DIR/openclaw-workspace"

HARD_RESET=0
for arg in "$@"; do
  case "$arg" in
    --hard) HARD_RESET=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./reset-project.sh [--hard]

Default reset:
- Stop all processes
- Clean run files/logs/runtime state/sqlite data
- Clean local OpenClaw persisted data to a fresh baseline

Hard reset:
- Include local docker volumes/data and generated local env files
EOF
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg"
      exit 1
      ;;
  esac
done

write_json_file() {
  local file="$1"
  local content="$2"
  mkdir -p "$(dirname "$file")"
  printf '%s\n' "$content" > "$file"
}

echo "[1/5] stop running services"
bash "$ROOT_DIR/stop-all.sh" >/dev/null 2>&1 || true

if [ -x "$APP_DIR/scripts/stop-local-docker-stack.sh" ]; then
  bash "$APP_DIR/scripts/stop-local-docker-stack.sh" >/dev/null 2>&1 || true
fi

echo "[2/5] clean runtime files"
rm -rf "$ROOT_DIR/.run"
mkdir -p "$ROOT_DIR/.run"
rm -f "$APP_DIR/logs/"*.log "$OPENCLAW_DIR/logs/"*.log 2>/dev/null || true

echo "[3/5] clean app state"
rm -f "$APP_DIR/data/"*.sqlite "$APP_DIR/data/"*.sqlite-shm "$APP_DIR/data/"*.sqlite-wal 2>/dev/null || true
rm -rf "$OPENCLAW_DIR/.openclaw-state"
mkdir -p "$OPENCLAW_DIR/.openclaw-state"
rm -rf "$OPENCLAW_DIR/workspace"
mkdir -p "$OPENCLAW_DIR/workspace"

echo "[3/5] clean local docker persisted state"
rm -rf "$OPENCLAW_DOCKER_STATE_DIR/agents" "$OPENCLAW_DOCKER_STATE_DIR/workspace"
rm -rf "$OPENCLAW_DOCKER_STATE_DIR/devices" "$OPENCLAW_DOCKER_STATE_DIR/identity"
rm -f "$OPENCLAW_DOCKER_STATE_DIR/update-check.json" "$OPENCLAW_DOCKER_STATE_DIR/cron/jobs.json.bak"
rm -rf "$OPENCLAW_DOCKER_WORKSPACE_DIR"
mkdir -p "$OPENCLAW_DOCKER_STATE_DIR/agents" "$OPENCLAW_DOCKER_STATE_DIR/workspace" "$OPENCLAW_DOCKER_STATE_DIR/canvas"
mkdir -p "$OPENCLAW_DOCKER_WORKSPACE_DIR"
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/devices/paired.json" '{}'
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/devices/pending.json" '{}'
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/identity/device.json" '{}'
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/identity/device-auth.json" '{}'
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/cron/jobs.json" '{"version":1,"jobs":[]}'
write_json_file "$OPENCLAW_DOCKER_STATE_DIR/update-check.json" '{}'

echo "[4/5] clean temp check artifacts"
rm -f /tmp/dcf-health.json /tmp/dcf-front.html /tmp/dcf-admin.html 2>/dev/null || true

if [ "$HARD_RESET" = "1" ]; then
  echo "[5/5] hard reset cleanup"
  if command -v docker >/dev/null 2>&1; then
    STACK_DIR="$APP_DIR/docker/local"
    if [ -f "$STACK_DIR/.env" ]; then
      docker compose --env-file "$STACK_DIR/.env" -f "$STACK_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
    else
      docker compose -f "$STACK_DIR/docker-compose.yml" down -v >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$APP_DIR/.env" "$APP_DIR/.env.production.local"
  rm -f "$APP_DIR/docker/local/.env"
else
  echo "[5/5] skip hard reset artifacts (use --hard to include docker volumes/env)"
fi

echo "reset complete"
echo "next: $ROOT_DIR/init-project.sh && $ROOT_DIR/start-all.sh"
