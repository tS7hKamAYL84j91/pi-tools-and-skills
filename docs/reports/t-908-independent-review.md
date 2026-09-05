# T-908 Independent Review

Status: active

## Verdict: PASS (conditional on integration reconciliation)

The bounded T908 behavior is implemented, the corrected implementation artifact has required `Status: active` metadata, and the architecture suite is green. Integration must still reconcile the now-landed T896 overlay refactor rather than apply the T908 overlay patch as a blind textual merge.

## Source and ticket review

Reviewed canonical ticket `/home/jim/git/working-notes/executive-office/chief-of-staff/pi-kanban/tasks/T-908.md`, implementation plan, implementation report, current worktree diff, ADR-004, and the changed public contract documentation.

The patch is limited to blocked deletion behavior: the TUI allows confirmation for `blocked`, shared `deleteTask` rejects only `in-progress`, and the existing transaction/audit path remains in use. The model-visible delete tool contract is updated consistently; this changes permitted task state, not schemas, actor/permission rules, or authorization roles. No dependency, board migration, live-board operation, or unrelated extension change was observed.

## Behavioral evidence

Focused command:

```text
npx vitest run tests/kanban/pi-kanban-tools-snapshot-overlay.test.ts
1 file passed, 12 tests passed, exit 0
```

The focused tests cover:

- Actual TUI delete confirmation for a blocked task.
- `n` cancellation with no `DELETE` event.
- Confirmed blocked deletion through the shared delete path.
- `in-progress` rejection.
- `DELETE` audit text including reason and actor.
- Snapshot/replay exclusion after deletion.
- Existing move restrictions.

The test harness uses temporary Kanban directories; no live board was mutated.

## Contract and ADR consistency

The changed `extensions/pi-kanban/README.md`, `extensions/pi-kanban/skills/pi-kanban/SKILL.md`, `board-tools.ts` description, and `docs/adr/004-overlay-guard-pattern.md` consistently state that blocked tasks may be soft-deleted after confirmation and `in-progress` tasks remain forbidden. The implementation report accurately describes the shared transaction and public-contract updates, subject to the status metadata correction below.

## T896 overlap

The actual integration worktree is clean at pushed commit `0d7d786` (`fix(kanban): preserve selection with priority-ordered active columns`). Its overlay differs materially from the T908 base: T896 adds priority-order selection/refresh behavior and `overlay-selection.ts`, while T908 exports `KanbanOverlay`, adds focused controller coverage, and removes only the blocked-delete guard. T896 also changes the same overlay-focused test file. The T908 change must be rebased/reapplied onto `0d7d786` while preserving T896's selection identity, watcher refresh, filtering, and scroll behavior; do not restore the old `clampSelection` implementation or delete T896's helper modules. No T896 transaction/schema/permission change was observed.

## Architecture evidence

The corrected implementation artifact was read and verified to contain `Status: active` and the Mermaid C4 update. The actual architecture reruns were:

```text
/tmp/pi-tools-T908:        1 file passed, 68 tests passed, exit 0
/tmp/pi-tools-integration: 1 file passed, 68 tests passed, exit 0
```

The prior sole architecture failure is resolved without a fitness exemption.

## Integration disposition

1. Reapply the T908 behavioral delta onto `origin/main` at `0d7d786`; preserve T896's overlay selection/refresh implementation.
2. Retain explicit `y`/Enter confirmation and `n`/Escape cancellation, shared transaction locking, `in-progress` rejection, DELETE audit, and replay exclusion.
3. Re-run the focused T908 test after reconciliation, then full checks/tests before integration.
4. Do not expand tool schemas, permissions, actor authorization, deletion semantics beyond blocked-task support, or live-board behavior.

No source/test edits, commit, merge, push, or live-board operation was performed during this review.

## Final integration review — PASS (conditional on GM gates)

Reviewed the actual dirty integration worktree atop shipped T896 commit `0d7d786`, not only the prior branch pointer. The non-overlay T908 changes apply cleanly. The exact overlay delta is limited to exporting `KanbanOverlay` for controller coverage and removing the `blocked` delete guard; T896's priority ordering, selection identity, watcher refresh, filtering, and scroll behavior remain present. The T908 focused test changes coexist with T896's selection tests.

Current integration evidence:

```text
npx vitest run tests/kanban/pi-kanban-tools-snapshot-overlay.test.ts \
  tests/kanban/pi-kanban-overlay-controller.test.ts \
  tests/kanban/pi-kanban-overlay-selection.test.ts
3 files passed, 17 tests passed, exit 0

npx vitest run tests/architecture.test.ts
1 file passed, 68 tests passed, exit 0

git diff --check
exit 0
```

The initial integration-focused attempt failed because `KanbanOverlay` was not exported; the correction restored the reviewed export and did not weaken tests or production guards. The final controller test confirms blocked confirmation/cancellation and DELETE execution, while the selection tests cover the preserved T896 overlay behavior. The shared transaction still rejects only `in-progress`; audit/replay behavior and the public tool/README/SKILL/ADR contract remain aligned. No schema, permission, actor-authorization, dependency, or live-board expansion was introduced.

Integration guidance: retain the exact narrow overlay delta, do not revert T896 selection helpers or refresh logic, and complete GM full `check`/test gates before source integration. This review is PASS subject to those gates; no commit or merge was performed.
