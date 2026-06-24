# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

complete the recommendations set out in docs/reports/t-745-fitness-exception-audit.md

**🔴 AUTONOMY RULE — READ FIRST:**
The implementation agent is expected to complete outstanding items without asking the user for confirmation.

- Pick work from this TODO, implement it, validate it, and update this file.
- Use the smallest useful change.
- Preserve useful content; do not delete source material unless it is clearly duplicate, empty, generated junk, or moved with an auditable note.
- Prefer moves/renames over rewrites.
- Escalate architecture, security, broad policy decisions, or destructive cleanup to `llm-council` when available.
- Use `navigator` review when substantial repo changes are made and team tools are available.

Progress markers:
- `[ ]` Planned
- `[~]` In progress
- `[R]` Ready for review
- `[x]` Done
- `[!]` Blocked

---

## How to use this TODO

1. Claim an item — change `[ ]` to `[~]` and add a dated note with intended scope.
2. Implement the smallest useful change.
3. Refactor only as needed to keep the result simple.
4. Validate with project checks or a documented manual check.
5. Update docs/architecture notes when the project requires it.
6. Change to `[R]` when ready for review, then `[x]` after validation/review.
7. If blocked, change to `[!]`, record the blocker and next decision needed, then stop broadening scope.

## Remaining TODO Items

- [x] (1.1) Inspect the current repository state and refine this TODO into concrete, verifiable tasks derived from the goal.
- [x] (2.1) Clean up `DIRECT_STATE_WRITE_EXCEPTIONS` in `tests/architecture/runtime-state-boundaries.ts`.
- [x] (2.2) Refactor `extensions/pi-kanban/board.ts#applyEvent` to accept a single event object (`BoardEvent`) with ≤4 declared parameters.
  - Remove the `allowsParameterException` bypass in `tests/architecture/clean-code.ts`.
- [x] (2.3) Remove the `allowHotspotGrowth` flag from `tests/architecture/hotspots.ts`.
- [x] (2.4) Harden exception metadata for `LINE_BUDGET_EXCEPTIONS` and `COUPLING_BUDGETS`.
  - Eliminate vague "legacy"/"later" reasons or link them to a ticket.
  - Add explicit target removal/reduce dates and an age/deadline test.
- [x] (2.5) Run `npm run check` and `npm test`; fix any regressions.
- [x] (2.6) Mark `docs/reports/t-745-fitness-exception-audit.md` as complete and move it to `docs/archive/reports/`.
- [x] (1.4) Final summary.
  - **Done:**
    - `DIRECT_STATE_WRITE_EXCEPTIONS` reduced to three documented core IO-layer modules (`lib/private-local-mode.ts`, `lib/session-spool.ts`, `lib/session-hook-installer.ts`); stale extension entries removed; added assertions that no extension path appears in the list and that reasons avoid "later"/"legacy".
    - `extensions/pi-kanban/board.ts#applyEvent` refactored to accept a single `BoardEvent` object (1 declared parameter); removed `allowsParameterException` from `tests/architecture/clean-code.ts`.
    - `allowHotspotGrowth` field removed from `LineBudgetException` and the hotspot-growth bypass in the top-hotspot test.
    - `LINE_BUDGET_EXCEPTIONS` and `COUPLING_BUDGETS` updated with `createdAt`/`targetDate` fields, concrete remediation/decoupling plans, and tests verifying target dates are within 90 days of creation and reasons avoid open-ended "later"/"legacy" language.
    - Report status set to `complete` and moved to `docs/archive/reports/t-745-fitness-exception-audit.md`.
  - **Validation:** `npm run check` (namespace, template-safety, typecheck, lint, knip, type-coverage) and `npm test` (874 tests) both pass.
  - **Blockers/follow-up:** None.

---

## Completion Criteria

- All TODO items are `[x]`, `[R]` with review notes, or `[!]` with explicit blockers.
- Required validation has passed or has a documented reason why it cannot run.
- Final state and evidence are recorded in this file.
