# 06 Local Docker Dependencies (OpenClaw + WeKnora)

## Goal

- Runtime dependencies must run locally via Docker.
- No runtime dependency on remote OpenClaw/knowledge services.
- Security defaults: loopback-only exposure, token/API-key required, least privilege.

## Stack

- OpenClaw Gateway: `127.0.0.1:18789` (managed by DCF scripts)
- Official WeKnora service: local deployment from `Tencent/WeKnora` (managed by WeKnora repo/scripts)

Files:

- Compose: `app/docker/local/docker-compose.yml` (OpenClaw only)
- Official WeKnora source: `app/vendor/WeKnora` (git clone from Tencent/WeKnora)
- Scripts:
  - `app/scripts/start-local-docker-stack.sh`
  - `app/scripts/check-local-docker-stack.sh`
  - `app/scripts/stop-local-docker-stack.sh`
  - `app/scripts/start-official-weknora.sh`
  - `app/scripts/check-official-weknora.sh`
  - `app/scripts/stop-official-weknora.sh`

## Security Baseline

1. Bind host ports to loopback only (`127.0.0.1`).
2. Require OpenClaw token (`OPENCLAW_GATEWAY_TOKEN`).
3. Require WeKnora API key (`WEKNORA_API_KEY`).
4. Drop Linux capabilities (`cap_drop: [ALL]`).
5. Enable `no-new-privileges:true`.
6. Keep WeKnora deployment and its persistent data managed in WeKnora project itself.
7. Keep DCF app `OPENCLAW_ALLOWED_HOSTS` limited to loopback/localhost.

## Usage

1. Start dependencies:
   - `cd /Users/zqs/Downloads/project/DCF/app`
   - `git clone https://github.com/Tencent/WeKnora.git vendor/WeKnora` (first time only)
   - `./scripts/start-local-docker-stack.sh`
2. Verify:
   - `./scripts/check-local-docker-stack.sh`
3. Stop:
   - `./scripts/stop-local-docker-stack.sh`

## DCF Environment Mapping

Use `app/config/runtime-permission.local-docker.env.example` as baseline:

- `OPENCLAW_BASE_URL=http://127.0.0.1:18789`
- `OPENCLAW_GATEWAY_TOKEN=<from app/docker/local/.env>`
- `WEKNORA_BASE_URL=http://127.0.0.1:19080`
- `WEKNORA_API_KEY=<from app/docker/local/.env>`
- `WEKNORA_WEB_URL=http://127.0.0.1:19080`

## Notes

- DCF relies on the official WeKnora endpoints:
  - `POST /api/v1/knowledge-bases`
  - `POST /api/v1/knowledge-bases/{id}/knowledge/manual`
  - `POST /api/v1/knowledge-search`
- DCF no longer provides a local mock knowledge server.
