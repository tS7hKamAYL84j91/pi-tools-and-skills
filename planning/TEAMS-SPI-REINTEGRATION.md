# Teams SPI Reintegration Review

## Goal
Rebase the unmerged `refactor/pi-teams-decoupling` slice onto `main` and determine whether its pluggable Teams protocol SPI should be integrated.

## Scope
- Rebase only in an isolated worktree.
- Review API shape, layering, current Teams compatibility, tests, and architecture documentation alignment.
- Do not merge or alter `main` without a separate approved integration decision.

## Non-goals
- No generic workflow/DAG engine.
- No unrelated Teams, Boost, TTL, or T-850 changes.

## Milestones
- [x] Rebase the branch on current `main`.
  - Validation command: `git -C /tmp/pi-teams-spi-reintegration rebase main`
  - Validation result: PASS (2026-08-21; one architecture-test import conflict resolved by retaining both current ADR-047 and SPI fitness imports).
- [x] Run focused Teams/SPI and architecture validation; record conflicts and regressions.
  - Validation command: `cd /tmp/pi-teams-spi-reintegration && npx vitest run tests/teams tests/lib/team-protocol-spi.test.ts tests/architecture && npm run typecheck`
  - Validation result: PASS (2026-08-21; 46 files / 356 tests; typecheck passes). The run exposed `team-protocol-spi.ts` missing from the shared-lib allowlist; fixed in `35ab48b` with a regression fitness assertion.
- [x] Review the rebased diff and record the integration recommendation.
  - Validation command: `git -C /tmp/pi-teams-spi-reintegration diff --check main...HEAD`
  - Validation result: PASS (2026-08-21); recommendation DEFER. Principal directed Teams extraction first, retaining the direct static handler registry and isolating the SPI on `defer/team-protocol-spi` for a separate future decision.

## Done when
A rebased branch, validation evidence, and a merge/defer recommendation are recorded. `main` remains unchanged unless a follow-up integration is explicitly approved.
