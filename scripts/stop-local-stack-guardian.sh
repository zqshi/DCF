#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Stop any background guardian loop started by run-local-stack.command
pkill -f "$ROOT_DIR/run-local-stack.command" >/dev/null 2>&1 || true
pkill -f "local-stack-guardian.log" >/dev/null 2>&1 || true

echo "local stack guardian stop requested"
