#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$ROOT_DIR/app"
OPENCLAW_DIR="$ROOT_DIR/runtime/openclaw"

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
    echo "[deps] ${label} already installed"
    return 0
  fi
  echo "[deps] install ${label} (${install_cmd})"
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

copy_env_if_missing() {
  local src="$1"
  local dst="$2"
  if [ -f "$dst" ]; then
    return 0
  fi
  if [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "[env] created $(basename "$dst") from $(basename "$src")"
  fi
}

require_cmd node
require_cmd npm
require_cmd pnpm

if [ "${DCF_SKIP_RESET:-0}" != "1" ]; then
  echo "[reset] clean project runtime state (DCF + OpenClaw)"
  bash "$ROOT_DIR/reset-project.sh"
else
  echo "[reset] skipped (DCF_SKIP_RESET=1)"
fi

copy_env_if_missing "$APP_DIR/.env.example" "$APP_DIR/.env"
copy_env_if_missing "$APP_DIR/.env.production.example" "$APP_DIR/.env.production.local"

install_deps_if_needed "$APP_DIR" "node_modules" "npm install" "app"
install_deps_if_needed "$OPENCLAW_DIR" "node_modules" "pnpm install" "openclaw"

if [ ! -f "$OPENCLAW_DIR/dist/index.js" ] || [ "${DCF_FORCE_BUILD_OPENCLAW:-0}" = "1" ]; then
  echo "[build] pnpm build (runtime/openclaw)"
  (
    cd "$OPENCLAW_DIR"
    pnpm build
  )
else
  echo "[build] openclaw dist exists, skip build"
fi

if [ "${DCF_USE_LOCAL_DOCKER_DEPS:-1}" = "1" ]; then
  if [ -x "$APP_DIR/scripts/start-local-docker-stack.sh" ]; then
    echo "[docker] start local dependencies"
    bash "$APP_DIR/scripts/start-local-docker-stack.sh"
  else
    echo "error: docker dependency script not found: $APP_DIR/scripts/start-local-docker-stack.sh"
    exit 1
  fi
fi

echo "init complete"
echo "next:"
echo "1) $ROOT_DIR/start-all.sh"
echo "2) $ROOT_DIR/check-all.sh"
