# Project AGENTS

## Mandatory Context Load Order

Before any implementation task, read in order:

1. `/Users/zqs/Downloads/project/DCF/docs/standards/01-architecture.md`
2. `/Users/zqs/Downloads/project/DCF/docs/standards/02-tdd-workflow.md`
3. `/Users/zqs/Downloads/project/DCF/docs/standards/03-quality-gates.md`

If a task conflicts with these standards, explicitly document the exception in a result note.

## Implementation Policy

1. Prefer DDD-lite (domain/application/infrastructure/interfaces/shared).
2. Use TDD for domain and use-case behavior.
3. Keep module boundaries explicit and files small.
4. Keep frontend and backend contracts versioned and stable.
5. Skills must be classified: `general` or `domain`.
6. OSS introduction must go through search + evaluation pipeline.

## Default Request Workflow (No Prior Context)

For any new request with no established conversation context, follow this sequence before implementation:

1. Read relevant project history first (existing code, tests, and nearby change artifacts).
2. Define scope boundaries (affected modules, interfaces/contracts, data paths, dependencies).
3. Run impact detection and risk assessment (regression risk, compatibility risk, boundary violations).
4. Only then implement changes and validate through TDD + quality gates.

Goal: avoid uncontrolled impact on the existing project.
