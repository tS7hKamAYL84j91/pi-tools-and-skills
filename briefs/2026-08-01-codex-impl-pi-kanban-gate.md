# T-802 — pi-kanban stop-and-fix completion gate

## Goal
Add a hard stop-and-fix completion gate to `kanban_complete` in `extensions/pi-kanban/`, enforcing structured verification evidence and the documented owner check. Align the evidence pattern with T-797 pi-goal (`command` + `result` + `exit_code`, hard-block on missing/failed) but keep all code inside the pi-kanban boundary.

## Background gap
`task-tools.ts:91-131` currently only checks `task.col === "in-progress"` before appending `COMPLETE` and `MOVE`. The documented owner check (`agent === task.claimAgent`) at :100-103 is not enforced. `TaskState` in `board.ts:196-215`, the `COMPLETE` event handler, task files, snapshot detail, and JSON export have no structured verification fields.

## In scope
1. Add structured verification evidence to `kanban_complete` parameters and the `COMPLETE` event payload.
   - `checks`: array of `{ command, result, exit_code }` objects.
   - Hard-block (throw) completion when `requireChecks` is true and evidence is missing or any `exit_code !== 0`.
2. Enforce owner check: `agent === task.claimAgent` before any write.
3. Persist evidence on `TaskState`, task detail, and JSON export.
4. Add `verification_required` to `TaskState`; support `KANBAN_REQUIRE_CHECK_EVIDENCE=1` env fallback.
5. Update `parseBoard` `COMPLETE` handling to materialise new fields.
6. Tests for missing evidence, failed evidence, wrong owner, and successful evidence.
7. `npm run check` clean; architecture fitness tests green.

## Out of scope
- No command execution inside the extension (evidence is reported by the agent).
- No migration of existing tickets (new fields default to empty/absent).
- No shared lib import from pi-goal; evidence shape is conceptual alignment only.

## Files to change
- `extensions/pi-kanban/task-tools.ts` — orchestrate tool registrations.
- `extensions/pi-kanban/complete-tool.ts` — new module for `kanban_complete` enforcement.
- `extensions/pi-kanban/schemas.ts` — add `CHECK_ITEM_SCHEMA`.
- `extensions/pi-kanban/board.ts` — re-export `TaskState`/`TaskVerificationCheck`; import parser helpers.
- `extensions/pi-kanban/board-event-handlers.ts` — new module: `TaskState`, event application, `parseKV`, `formatChecks`.
- `extensions/pi-kanban/compaction.ts` — preserve verification fields during compaction.
- `extensions/pi-kanban/snapshot.ts` — render verification evidence in task detail.
- `extensions/pi-kanban/export.ts` — export verification evidence.
- `extensions/pi-kanban/README.md` — document verification gate and env policy.
- `tests/kanban/pi-kanban-tools-complete-gate.test.ts` — new regression tests.
- `briefs/2026-08-01-codex-impl-pi-kanban-gate.md` — this brief.

## Acceptance gates
1. Hard-block rejects missing evidence when `verification_required` is true.
2. Hard-block rejects evidence with `exit_code !== 0`.
3. Owner-match (`agent === claimAgent`) enforced before any write.
4. Evidence persists in `TaskState`, task detail, and JSON export.
5. Existing tests pass; new tests cover the four cases above.
6. `npm run check` clean.
7. Architecture fitness tests green (no module line-budget violations).

## Review plan
Navigator review before closing.

## Implementation status
- [x] Types and `COMPLETE` event payload updated.
- [x] `kanban_complete` owner check and verification gate implemented in `complete-tool.ts`.
- [x] `KANBAN_REQUIRE_CHECK_EVIDENCE=1` and per-task `verification_required` policy wired.
- [x] Evidence persists in `TaskState`, task detail, JSON export, and survives compaction.
- [x] README updated.
- [x] Regression tests added and passing.
- [x] Full validation: `npx vitest run` (141 files / 1056 tests), `npm run check` clean, architecture tests green.
