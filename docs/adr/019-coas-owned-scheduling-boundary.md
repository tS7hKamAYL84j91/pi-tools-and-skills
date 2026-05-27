# ADR 019: CoAS owns recurring scheduling over kanban board tools

Date: 2026-05-27
Status: accepted

## Context

`pi-kanban` exposes a reusable event-sourced board, board tools, snapshots, task files, a live overlay, and board-change watcher notifications. `pi-coas` owns operational scheduling through its file-backed schedule registry and pi-hosted internal scheduler.

Recurring operational policies such as WIP pick routines, morning briefs, state capture, and recurring reviews need schedule semantics, cadence, and policy ownership. Putting those policies in `pi-kanban` would couple a generic board surface to one operator workflow.

## Decision

- `pi-kanban` remains the reusable board/tooling/event surface.
- `pi-kanban` may keep board-local mechanics: append-only events, WIP enforcement for claims, snapshots, compaction, task files, overlay rendering, and board-change watcher notifications.
- `pi-kanban` must not own cron, recurring schedules, morning briefs, operational review cadence, state-capture cadence, or CoAS business policy.
- `pi-coas` owns recurring operational schedules and policies. Its scheduler may call or instruct use of `kanban_*` tools through scheduled prompts or a future narrow adapter, but ownership remains in CoAS.
- No cross-extension TypeScript imports are introduced. Scheduler-to-kanban interaction is through model-visible tools today; any future programmatic surface must avoid circular ownership and keep `pi-kanban` schedule-free.

## Consequences

- Existing `pi-kanban` watcher notifications are acceptable because they are event-driven board-change nudges, not recurring schedules.
- Existing `pi-kanban` WIP limit and claim selection remain board mechanics; recurring WIP pick/capacity-review policy belongs in `pi-coas` schedules.
- `pi-coas` can coordinate kanban operations without `pi-kanban` depending on CoAS.
- T-556 should define a clean scheduler-facing kanban read/action surface if prompts are insufficient, without adding cron or business scheduling to `pi-kanban`.

## Rejected alternatives

- Add recurring review or WIP-pick schedules to `pi-kanban`: rejected because it makes the board extension a workflow scheduler.
- Import `pi-kanban` internals directly from `pi-coas`: rejected because current architecture enforces extension isolation and prevents cross-extension coupling.
