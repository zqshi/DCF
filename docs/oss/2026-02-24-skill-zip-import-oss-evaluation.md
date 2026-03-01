# OSS Introduction Evaluation - Skill ZIP Import (2026-02-24)

## Requirement
- Stable ZIP upload + extraction for admin skill import.
- Avoid runtime dependency on host binaries (`unzip`, `python3`) to reduce environment drift.

## Candidates
1. `unzipper`
- Source: https://www.npmjs.com/package/unzipper
- Source: https://github.com/ZJONSSON/node-unzipper
- License: MIT

2. `adm-zip`
- Source: https://www.npmjs.com/package/adm-zip
- Source: https://github.com/cthackers/adm-zip
- License: MIT

3. `jszip`
- Source: https://www.npmjs.com/package/jszip
- Source: https://github.com/Stuk/jszip
- License: MIT or GPLv3

## Evaluation Score (0-100)
- Stability in Node backend runtime: 35%
- Streaming/large archive safety: 25%
- API simplicity for current use case: 20%
- License/compliance clarity: 10%
- Maintenance signal: 10%

| Candidate | Stability | Safety | Simplicity | Compliance | Maintenance | Total |
|---|---:|---:|---:|---:|---:|---:|
| unzipper | 30 | 22 | 16 | 10 | 7 | 85 |
| adm-zip | 28 | 14 | 18 | 10 | 7 | 77 |
| jszip | 22 | 14 | 13 | 8 | 8 | 65 |

## Decision
- Adopt `unzipper`.

## Rationale
- Removes dependency on host executables and makes behavior deterministic across environments.
- Supports robust ZIP parsing in Node server context and aligns with current architecture.
- MIT license with clear upstream repository and ecosystem usage.

## Integration Scope
- `app/src/infrastructure/integrations/SkillBundleArchiveGateway.js`
- Admin skill import route and tests only.
- No API contract break: `/api/admin/skills/import` remains backward compatible.
