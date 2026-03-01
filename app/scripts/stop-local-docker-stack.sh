#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="$APP_DIR/docker/local"
COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
ENV_FILE="$STACK_DIR/.env"

if command -v docker >/dev/null 2>&1; then
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  else
    docker compose -f "$COMPOSE_FILE" down >/dev/null 2>&1 || true
  fi
fi

if [[ -x "$APP_DIR/scripts/stop-official-weknora.sh" ]]; then
  bash "$APP_DIR/scripts/stop-official-weknora.sh" >/dev/null 2>&1 || true
fi

echo "local docker stack stopped (openclaw + official WeKnora)"
