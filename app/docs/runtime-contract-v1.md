# Runtime Contract v1

## Version

- Contract version: `v1`
- Request header: `X-Contract-Version: v1` (required for `/runtime/tasks*`)

## Endpoints

### 1) Submit Task

- Method: `POST`
- Path: `/runtime/tasks`
- Request body schema: `contracts/runtime-task-submit.schema.json`
- Success response:
  - `200`
  - `{ "accepted": true, "runtimeTaskId": "string", "queuedAt": "ISO-8601" }`

### 2) Get Task Status

- Method: `GET`
- Path: `/runtime/tasks/:id`
- Success response:
  - `200`
  - `contracts/runtime-task-status.schema.json`
- Not found:
  - `404`
  - `contracts/runtime-error.schema.json`

### 3) Get Task Events

- Method: `GET`
- Path: `/runtime/tasks/:id/events`
- Success response:
  - `200`
  - `RuntimeEvent[]` where each item follows `contracts/runtime-task-event.schema.json`

### 4) Abort Task

- Method: `POST`
- Path: `/runtime/tasks/:id/abort`
- Success response:
  - `200`
  - `{ "ok": true, "status": "aborted" }`
- Not found:
  - `404`
  - `contracts/runtime-error.schema.json`

### 5) Runtime Health

- Method: `GET`
- Path: `/runtime/health`
- Success response:
  - `200`
  - `{ "ok": true, "service": "string", "now": "ISO-8601" }`

## Status Model

- Allowed values: `queued | running | succeeded | failed | aborted`
- Terminal states: `succeeded | failed | aborted`
- Recommended state transitions:
  - `queued -> running -> succeeded`
  - `queued -> running -> failed`
  - `queued -> aborted`
  - `running -> aborted`

## Error Contract

- Error payload uses `contracts/runtime-error.schema.json`
- Required fields:
  - `error.message`
- Optional fields:
  - `error.code`
  - `error.severity` (`P1 | P2`)
  - `error.details`

## Audit Requirements

Runtime event payload SHOULD carry:

- `trace_id`
- `task_id`
- `employee_id`
- `timestamp`

These fields are mandatory for production audit gates even if some local compatibility servers return a smaller payload.

