# 03 Quality Gates

## Required Gates

1. All tests pass.
2. No layer-boundary violations.
3. API compatibility maintained or explicitly versioned.
4. New skills classified as `general` or `domain`.
5. OSS candidate introduction has evaluation score and rationale.

## Runtime Gates

1. P1 risk event triggers abort/rollback path.
2. Audit fields must include `trace_id`, `task_id`, `employee_id`.
3. Task loop must preserve deterministic state transitions.
