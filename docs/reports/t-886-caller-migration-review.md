# T-886 Caller-Migration Independent Re-review

Status: active

Historical stage verdict; see `t-886-final-validation.md` for current status.

Date: 2026-09-05

Reviewed the latest caller-migration source, evidence, and regression tests. **Builder gate: REVISE.** The two prior bounded findings are corrected in source and covered by the new exact regression file, but the goal suite currently has one additional non-intentional failing test and the reported regression count was stale.

## Verified corrections

- Creation authority is committed before `writeGoalCreationArtifacts`; post-commit TODO/derived artifact failure is surfaced without retry or rebinding.
- `removeKnownRunArtifacts` removes only generated `*-iter-NNN.(jsonl|md)` files, preserves unknown nested content, and rejects unsafe symlink children.
- The new regression suite covers generated-instance creation, inactive-binding replacement, committed-but-unbound creation, successful clear preserving sibling/unknown files, unsafe nested run cleanup preserving the unknown target, and conflict/projection-failed outcomes.
- Source inspection confirms production callers use revision-bearing transaction helpers; `saveGoal`/`clearGoal` compatibility exports remain finalization cleanup items.

## Actually executed in this review

- `npx vitest run tests/goal/t-886-caller-migration-regressions.test.ts`: **PASS — 6 passed**. The prior report's “5 passed” count is stale.
- `npx vitest run tests/goal/pi-goal-transaction.test.ts`: **PASS — 10 passed**.
- `npx vitest run tests/goal/pi-goal-tools.test.ts`: **REVISE — 22 passed, 1 failed**. Failure: `/goal file <path> goal start creates a TODO and starts a 20-turn run` could not read the expected instance `goal.json`.
- `npx vitest run tests/goal`: **REVISE — 81 passed, 2 failed**. Failures are the same `pi-goal-tools` instance-artifact failure and the intentionally deferred duplicate-driver regression (`expected sends 1, received 2`).
- Primary LSP diagnostics for the reviewed persistence/command/regression files: **clean**.
- `npm run check` is recorded as PASS in the candidate evidence, but was **not rerun in this review**.

## Decision

The exact new tests now support the post-commit artifact and known-only cleanup corrections; those prior findings can be closed for this slice. Do not mark the caller-migration gate PASS while the existing goal-tools test remains red. This is the smallest current blocker: determine whether the missing instance artifact is an intentional fixture/contract update or a caller regression, correct it in the implementation lane, and rerun the goal suite and checks. Keep the duplicate-driver failure explicitly separate and red until the later ownership/admission slice.

Ownership tokens, send admission, identity-keyed waiters, replacement handoff, owner-only watchdog admission, child-process exclusion, and stale-await ownership remain out of scope and unapproved here. No source/test edits, peer spawn, commit, or live operation was performed.
