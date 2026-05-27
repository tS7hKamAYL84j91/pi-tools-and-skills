# T-556 Scheduler-Safe pi-kanban Surface

Date: 2026-05-28
State: verified with small documentation/test additions

## Result

The existing `kanban_*` tool surface is sufficient for external schedulers such as `pi-coas` to inspect board state and perform authorized board actions without adding cron or business scheduling ownership to `pi-kanban`.

## Scheduler-safe surface

| Need | Tool(s) | Behavior / error handling |
|---|---|---|
| Inspect board/todo/backlog/WIP/blocked/done | `kanban_snapshot` | Default compact summary; writes full `snapshot.md`; explicit `detail="full"` or `task_id` required for expanded context. |
| Claim/start one task | `kanban_claim` | Optional `task_id`; omitted `task_id` picks highest-priority todo. Non-mutating guard results include `NO_TASK_AVAILABLE`, `TASK_NOT_FOUND`, `WRONG_COLUMN`, and `WIP_LIMIT_REACHED`. |
| Add scheduler/progress note | `kanban_edit note=...` | Notes are allowed on any task; metadata edits are limited to backlog/todo. |
| Block work | `kanban_block` | Requires in-progress task; appends BLOCK and MOVE events. |
| Complete work | `kanban_complete` | Requires in-progress task; appends COMPLETE and MOVE events. |
| Prepare planning item | `kanban_move` | Only backlog ↔ todo. |

Schedulers should own cadence and policy text outside `pi-kanban`, call these tools only when authorized by their policy, and inspect structured result details instead of retrying blindly.

## Boundary verification

- No cron loop, scheduler daemon, recurring review cadence, morning brief policy, or state-capture cadence was added to `pi-kanban`.
- `pi-kanban` remains board mechanics plus event-driven watcher notifications.
- `pi-coas` remains the recurring schedule owner per ADR 019.
- Existing tests already cover read/action/error behavior; T-556 adds a smoke test that exercises the scheduler-safe sequence and guard result.

## ADR disposition

No new ADR is needed for T-556. ADR 019 already establishes the ownership boundary, and T-556 does not materially change public tool contracts or add scheduling behavior. It documents and verifies the existing tool surface.

## Caveats / future work

If prompt-mediated scheduler calls are insufficient, a future change can add a narrow scheduler-facing adapter after design review. It must remain schedule-free, preserve extension isolation, and keep cadence/business policy in `pi-coas`.
