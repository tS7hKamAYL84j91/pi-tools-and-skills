# T-851 Completion Plan

## Goal
Close the remaining ADR-047 pi-boost acceptance work without changing its security boundary or introducing extension dependencies.

## Constraints
- `pi-boost` and `pi-panopticon` must not import each other.
- Shared `lib/` discovery remains extension-neutral.
- Preserve fail-closed descriptor selection, reviewed-host authority, live-control revocation, and default-model invariance.
- Do not touch active architecture-refactor work.

## Milestones

- [x] Independent F.I.R.E./boundary review and remediation list.
  - Validation command: review findings trace to code/tests or are explicitly rejected.
  - Validation result: PASS — 2026-08-21; independent review found two filesystem fail-closed defects, fixed in `54d231d` and re-reviewed PASS.
- [x] Discovery, descriptor, and architecture fitness coverage.
  - Validation command: targeted Vitest suites.
  - Validation result: PASS — 2026-08-21; `f5f6423` and `54d231d`.
- [x] Lease composition, rollback, recovery, and Teams characterization coverage.
  - Validation command: targeted Vitest suites.
  - Validation result: PASS — 2026-08-21; `7083892` and `04e3bda`.
- [x] Integrate, simplify confirmed issues, update completion records.
  - Validation command: `git diff --check && npm run check && npm test && scripts/t851-artifact-smoke.sh`.
  - Validation result: PASS — 2026-08-21; full check 99.24%, test 1352/1352, artifact smoke passed.
