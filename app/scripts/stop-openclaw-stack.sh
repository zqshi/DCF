#!/usr/bin/env bash
set -euo pipefail

echo "Stopping DCF/OpenClaw local stack processes..."

pkill -f "src/server.js" || true
pkill -f "dist/index.js gateway --allow-unconfigured --bind loopback --port 18789" || true

echo "stop requested"
