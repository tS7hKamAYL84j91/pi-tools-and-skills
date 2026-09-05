# T908 Implementation Report

Status: active

## Result

Implemented confirmed deletion of blocked tasks from the Kanban TUI. The existing confirmation flow now reaches the shared `deleteTask` transaction for `blocked`; `in-progress` remains prohibited.

## Changes

- `extensions/pi-kanban/overlay.ts`: removed the blocked-task delete guard; exported the controller class for focused controller coverage.
- `extensions/pi-kanban/board-transactions.ts`: retained the atomic shared validation and changed the prohibition to `in-progress` only.
- `extensions/pi-kanban/board-tools.ts`, `extensions/pi-kanban/README.md`, `extensions/pi-kanban/skills/pi-kanban/SKILL.md`, and `docs/adr/004-overlay-guard-pattern.md`: updated the public behavior contract.
- `tests/kanban/pi-kanban-tools-snapshot-overlay.test.ts`: covered the pre-fix regression, confirmed blocked deletion through controller input, cancellation, DELETE audit text, replay exclusion, and existing in-progress rejection.

## Evidence

The regression test was intentionally changed before the production fix. Before the fix, the focused test failed with:

> `Cannot delete task T-121: it is currently in 'blocked'. Complete or unblock the task before deleting it.`

After the fix:

- Focused test: **12 passed** (`tests/kanban/pi-kanban-tools-snapshot-overlay.test.ts`)
- Full test suite: **1552 passed, 209 files**
- `npm run check`: typecheck, knip, and type coverage passed; lint completed with existing repository warnings/infos outside this T908 scope.
- Type coverage: **99.23%**
- LSP diagnostics on edited TypeScript files: **0 findings**
- Architecture suite (`npm test -- --run tests/architecture.test.ts`): **68 passed**, exit code **0**

All tests use temporary `KANBAN_DIR` directories. No live Kanban board, commit, or push was performed.

## Review handoff

Status remains active during independent review (`t795-luna-security`). Review the deletion authorization boundary, controller confirmation/cancellation behavior, transaction locking and DELETE replay, the Mermaid C4 description, and the intentionally small scope relative to T896.
