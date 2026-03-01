#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# Load local env file for runtime credentials/config without overriding
# already exported env (e.g., `PORT=8092 ./start.sh`).
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*) continue ;;
    esac
    if [[ "$line" != *=* ]]; then
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    if [ -z "$key" ]; then
      continue
    fi
    if [ -z "${!key+x}" ]; then
      export "$key=$value"
    fi
  done < .env
fi

if [ -z "${DB_DRIVER:-}" ]; then
  if node -e "require.resolve('better-sqlite3')" >/dev/null 2>&1; then
    DB_DRIVER="sqlite"
  else
    DB_DRIVER="memory"
    echo "[start.sh] better-sqlite3 not found, fallback to DB_DRIVER=memory"
  fi
fi

SQLITE_PATH="${SQLITE_PATH:-./data/dcf.sqlite}" DB_DRIVER="${DB_DRIVER}" node src/server.js
