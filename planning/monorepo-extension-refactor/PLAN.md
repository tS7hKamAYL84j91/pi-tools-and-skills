# Project Plan — Monorepo Extension Refactor and FIRE Review

## Milestones

- [x] Milestone 1: Stabilise ADR-043 and restore a trustworthy green baseline
  - Validation command: `npm run check && npm test && git diff --check`
  - Validation result: PASS — 2026-08-12: check clean, type coverage 99.17%; 151 test files passed/1 skipped, 1098 tests passed/5 skipped; diff check clean.
- [x] Milestone 2: Complete extension inventory, code forensics, architecture/dependency analysis, and initial FIRE matrix
  - Validation command: `test -s docs/archive/reports/2026-08-12-monorepo-extension-fire-review.md && test -s planning/monorepo-extension-refactor/KNOWLEDGE.md`
  - Validation result: PASS — 2026-08-12: all nine extensions inventoried; architecture/runtime/API audits and six-/twelve-month forensics synthesized into the durable BLOCKED FIRE report.
- [x] Milestone 3: Approve a minimal refactor queue from verified P0/P1 findings
  - Validation command: `rg -n "P0|P1|No verified P0/P1" docs/archive/reports/2026-08-12-monorepo-extension-fire-review.md`
  - Validation result: PASS — 2026-08-12: the user explicitly authorized complete extension refactoring; the FIRE report orders evidence-backed P0/P1 slices. Council execution returned empty output, so contested public gate-command/persistence-policy changes are deferred to Milestone 6 rather than silently decided.
- [x] Milestone 4: Refactor selected extension slices incrementally with characterisation tests
  - Validation command: `npm run knip && npx vitest run tests/architecture.test.ts tests/architecture/*.test.ts`
  - Validation result: PASS — 2026-08-12: full `npm run check` (including Knip) passed; full architecture suite passed within `npm test`. Slices include ADR-043, Kanban/file locking, CoAS confinement/lifecycle, Matrix bounds, Goal authority/confinement, team/Ollama/gate boundaries, result ownership, registry extraction, and verified dead-code deletion.
- [x] Milestone 5: Update architecture and complete full FIRE/release-readiness review
  - Validation command: `npm run check && npm test && git diff --check`
  - Validation result: PASS — 2026-08-12: typecheck/lint/Knip clean, type coverage 99.17%; 152 test files passed/1 skipped, 1131 tests passed/5 skipped; diff check clean; bounded touched-file secret scan contained only synthetic fixtures/defensive terms.
- [x] Milestone 6: Independent Navigator/council verification and completion audit
  - Validation command: `npm run check && npm test && git diff --check`
  - Validation result: PASS — final security/architecture/F.I.R.E. reviews completed; all concrete P0/P1 findings were resolved and narrowly re-reviewed. Final gates: 99.17% type coverage, 1142 tests passed/5 skipped, architecture 52/52. Two llm-council runs returned empty synthesis and are recorded as a tooling limitation.

## Goal

Produce a measured, behaviour-preserving refactor of the monorepo extension layer, backed by full code analysis, Dan Ward FIRE review, architectural evidence, and green release gates.

## Tasks

- [x] Integrate and close the ADR-043 corrective patch.
- [x] Inventory entrypoints, tools/commands, state, IO, dependencies, tests, and line counts per extension.
- [x] Run six-month hotspot/churn/coupling and twelve-month ownership analysis.
- [x] Inspect architecture fitness, Knip, strict TypeScript, network/subprocess/persistence and public surfaces.
- [x] Publish initial FIRE matrix with P0–P3 priorities and confidence.
- [x] Submit the proposed queue to council and record the empty-synthesis limitation.
- [x] Delegate sequential, bounded refactor slices; review each patch locally.
- [x] Publish final FIRE verdict and release evidence.

## Affected Files

- `extensions/**`
- Directly coupled `lib/**`
- `tests/**`
- `docs/architecture.md`
- `docs/archive/reports/2026-08-12-monorepo-extension-fire-review.md`
- `planning/monorepo-extension-refactor/**`

## Test Plan

- Baseline and final: `npm run check`, `npm test`, `git diff --check`.
- Each slice: focused Vitest files plus `npm run knip` and architecture tests.
- Bounded secret scan over touched files only.
- Independent Navigator review for focused patches; llm-council for final architecture/public API/security disposition.

## Runbook

1. Execute milestones in order.
2. Record validation evidence after each command; stop and fix or escalate on FAIL.
3. Do not start a refactor solely from file size or style preference; require behavioural or architecture evidence.

## Context

The goal starts from commit `b1b4b44`, whose ADR-043 implementation received a BLOCKED council review. Its corrective patch is already isolated in this worktree and is Milestone 1.
