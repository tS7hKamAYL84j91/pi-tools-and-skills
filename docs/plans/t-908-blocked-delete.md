# T908 — Confirmed deletion of blocked Kanban tasks

## Scope

Allow the TUI's confirmed delete action to delete `blocked` tasks through the existing shared `deleteTask` transaction. Preserve cancellation, reject `in-progress`, and retain the auditable `DELETE` event/replay behavior. No live board mutation, dependency, or T896 selection/priority work.

## Acceptance criteria

- `blocked` tasks enter the existing confirmation flow and a confirmed delete succeeds through `deleteTask`/`withBoardTransaction`.
- `n`/Escape cancellation remains non-mutating.
- `in-progress` deletion remains rejected; no DELETE event is appended.
- DELETE audit and replay still mark the task deleted and exclude it from active views.
- Focused Kanban tests, full tests, `npm run check`, and independent review handoff evidence are recorded.

## Implementation plan

1. Reproduce the existing blocked-delete regression with the focused Kanban test.
2. Update shared deletion validation and the TUI guard/contract documentation together; keep the in-progress prohibition.
3. Add focused controller/shared transaction tests for confirmed deletion, cancellation, rejection, and DELETE replay/audit.
4. Run diagnostics, focused tests, full tests, and `npm run check`.
5. Write the implementation report with evidence and stop for independent review; do not commit or push.

## Review plan

Review the diff for authorization boundary, confirmation behavior, transaction locking, audit/replay preservation, and scope contamination (especially T896). Verify no live Kanban directory was touched.
