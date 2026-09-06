# Work tracking

Work directly from Jim's requests and current repository evidence. Do not load
or manage Kanban from this project's agents; Gravitas owns the optional
human-facing overview. Board updates, planning documents, and status logs are
not prerequisites for doing the work. Do not duplicate execution records here.

## F.I.R.E. simplification — Goal, Teams, Kanban

Requested by Jim and implemented. This checklist records completed scope, not an
execution log. Model/profile defaults and live configuration were not changed.

### 1. Goal — remove generated process scaffolding

- [x] Remove task-claim, dated-note, and ready-for-review instructions from generated goal content (`extensions/pi-goal/goal-render.ts`).
- [x] Stop generating the disabled `PLAN.md` and consolidate redundant generated SPEC/STATUS/TODO projections into authoritative state plus one useful human-readable summary (`goal-persist.ts`, `goal-files.ts`). Preserve user-supplied source documents and existing history.
- [x] Remove the obsolete `/goal plan` and `/goal approve` no-op commands.
- [x] Preserve immediate execution, stop/pause/resume, single-driver ownership, session lineage, liveness containment, and evidence-based completion gates.
- [x] Test creation, file-backed goals, resume/recovery and completion; verify new goals do not recreate the removed scaffolding. Update usage docs.

### 2. Teams — one clear execution path and one state authority

- [x] Choose and document one canonical run/status/stop interface; identify redundant `/team`, `/teams`, `team_*` and `runtime_*` surfaces before removing them.
- [x] Consolidate redundant modes and aliases while retaining useful synchronous/asynchronous execution and cancellation. Do not add replacement compatibility machinery.
- [x] Make `TeamStateManager` authoritative; derive runtime views rather than maintaining competing team lifecycle records.
- [x] Keep Navigator optional, and Council/research explicitly requested or justified by the task. Ask Jim before changing model, routing, or profile defaults.
- [x] Test run/status/stop consistency, completed-run stop rejection, cancellation, session restoration and async delivery. Update commands, tools, skills and docs together.

### 3. Kanban — separate viewing from housekeeping

- [x] Make routine board/task viewing read-only: no snapshot-file writes, SNAPSHOT events, or compaction just to inspect the board (`extensions/pi-kanban/board-tools.ts`).
- [x] Keep snapshot export and compaction explicit, clearly named operations; remove maintenance coupling from the viewing path.
- [x] Keep Kanban an optional human overview owned by Gravitas, not an execution prerequisite for project agents.
- [x] Preserve owner checks, configured verification/completion gates, confirmations, durable history and backups.
- [x] Test that viewing leaves files/events unchanged, while explicit export and compaction retain their intended behavior. Update tool descriptions and docs.

### Validation

- [x] Run focused tests for each changed feature, then `npm run check`, `npm test`, and `git diff --check`. Report remaining risks without creating parallel progress reports.

## Historical references

The former board migration is recorded under T-890, with T-886 (Goals), T-891
(UX), T-892 (onboarding/usability), and T-893 (extension cleanup). These are
historical lookup references, not current priorities or authorization to start.

The [frozen migration source record](docs/reports/kanban-backlog-migration-source.md)
preserves the previous checklist and migration-time dispositions.
