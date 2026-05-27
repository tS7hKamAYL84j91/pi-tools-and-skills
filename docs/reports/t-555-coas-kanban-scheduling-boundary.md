# T-555 CoAS-Owned Scheduling Boundary over pi-kanban

Date: 2026-05-27
State: implemented as architecture/docs boundary; no runtime code change required

## Outcome

The current code already keeps recurring scheduling in `pi-coas` and board state/tools in `pi-kanban`. T-555 documents the boundary and records that no refactor is required now.

## Evidence inspected

- `extensions/pi-coas/scheduler.ts` owns the pi-hosted timer loop and injects due schedule prompts; it never reads or writes crontab.
- `extensions/pi-coas/schedules.ts`, `tools.ts`, `commands.ts`, `status.ts`, and `lifecycle.ts` own schedule registry, schedule tools, scheduler commands/status, and lifecycle.
- `extensions/pi-kanban/*` exposes board operations, snapshots, compaction, task files, overlay, and a board-change watcher.
- `extensions/pi-kanban/watcher.ts` is event-driven on `board.log` changes with idle/cooldown safeguards; it is not cron or recurring operational policy.
- No TypeScript cross-extension imports are used between `pi-coas` and `pi-kanban`.

## Boundary

- `pi-kanban`: reusable board/tooling/event surface; board mechanics such as WIP enforcement, claim selection, snapshots, compaction, and change notifications.
- `pi-coas`: recurring operational schedules and policy owner for WIP pick routines, morning briefs, state capture, recurring reviews, and other cadence-driven work.
- Current dependency path: CoAS schedules inject prompts that may call `kanban_*` tools. This avoids circular ownership.

## No-code rationale

No code/config currently places recurring schedules, cron, morning briefs, state capture, or CoAS business policy in `pi-kanban`. Changing runtime code would add risk without improving the boundary.

## T-556 follow-up

If prompt-mediated scheduler use of `kanban_*` tools is not clean enough, T-556 should add a narrow scheduler-safe kanban tool/read surface without cron in `pi-kanban`:

1. Define required scheduler operations: compact board read, candidate pick preview, claim by task id, state capture summary.
2. Prefer existing model-visible `kanban_snapshot`/`kanban_claim`/`kanban_edit` unless a programmatic extension host tool-call adapter is approved.
3. Keep `pi-kanban` schedule-free and policy-neutral; CoAS owns cadence and policy text.
4. Preserve extension isolation; no direct cross-extension imports unless an ADR revises the architecture rule.

## ADR disposition

Created `docs/adr/019-coas-owned-scheduling-boundary.md` because this is a durable ownership boundary between two extensions.
