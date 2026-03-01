#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEKNORA_DIR="${WEKNORA_DIR:-$APP_DIR/vendor/WeKnora}"

if [[ ! -d "$WEKNORA_DIR" ]]; then
  echo "official WeKnora repo not found: $WEKNORA_DIR"
  exit 1
fi

(
  cd "$WEKNORA_DIR"
  bash ./scripts/start_all.sh --stop
)

echo "official WeKnora stop requested"
