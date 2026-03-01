# 04 Persistence Switch

## Goal

Switch storage driver without changing business use-cases or HTTP contracts.

## Drivers

1. `sqlite` (default, `better-sqlite3`)
2. `memory` (explicit opt-in, recommended only for local temporary runs)
3. `postgres` (`pg`)

## Persistence Model

1. Table-level persistence (not single snapshot row).
2. Tables: `employees`, `conversations`, `messages`, `tasks`, `skills`, `events`, `research_queue`, `oss_findings`, `metrics`.
3. Incremental persistence by object-level upsert + delete-diff sync per table.
4. Metrics persistence also uses upsert + stale-key cleanup.
5. Business APIs stay driver-agnostic.

## Env Contract

1. `DB_DRIVER=memory|sqlite|postgres`
2. `SQLITE_PATH=...` (for sqlite)
3. `POSTGRES_URL=...` (for postgres)

## Guardrails

1. API contract must remain stable across drivers.
2. Domain and application layers must not import DB packages.
3. Driver-specific logic stays in `infrastructure/repositories`.
