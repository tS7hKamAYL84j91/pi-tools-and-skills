# Work tracking

Work directly from Jim's requests and current repository evidence. Do not load
or manage Kanban from this project's agents; Gravitas owns the optional
human-facing overview. Board updates, planning documents, and status logs are
not prerequisites for doing the work. Do not duplicate execution records here.

## Code-health follow-ups

Requested by Jim after the repository-wide review. Keep fixes bounded and preserve
public contracts, persistence compatibility, permissions, and live configuration.

### High priority

- [x] **Enforce File Watch path restrictions** (`extensions/pi-file-watch/watcher.ts`). Validate resolved targets independently of watch behavior; prevent an internal symlink from bypassing `allowExternalPaths: false` when `followSymlinks: false`. Add regression tests for file and parent-directory symlinks, both flags, and target changes. Rejected targets must not be read or hashed.
- [x] **Preserve Boost recovery state after failed dispatch** (`extensions/pi-boost/index.ts`). Treat `setModel()` returning `false` during baseline restoration as a failure, retain the original model, and block further boosts until restoration succeeds. Test both false returns and thrown errors, status reporting, and `/boost reset` recovery.

### Medium priority

- [x] **Bound subagent output retention** (`extensions/pi-panopticon/spawner/spawn-service.ts`). Apply the recent-event cap to stderr as well as stdout; bound retained bytes and unfinished stdout lines. Preserve RPC framing for valid messages and define explicit handling for oversized frames. Test stderr floods and large unterminated lines with mocked children.
- [x] **Truncate Fleet inbox text on UTF-8 boundaries** (`fleet-mcp/gateway.ts`). Ensure returned text is a valid prefix of the input and never exceeds `maxTextBytes`. Preserve the response shape and truncation flag. Test ASCII, multibyte characters, emoji, and exact-boundary inputs; `éé` truncated to three bytes must return `é`, not `é�`.
- [x] **Remove unbounded synchronous File Watch hashing** (`extensions/pi-file-watch/watcher.ts`, `config.ts`). Choose and document streaming asynchronous hashing or an explicit size limit with hash omission. Resolve the unused `maxBytes` setting deliberately; preserve metadata-only notifications and cancellation/reload behavior. Test large files, unreadable/deleted targets, and pending work during reload.

### Documentation

- [x] **Refresh bundled Pi development references** (`skills/pi-extension-dev/references/`). Verify examples against the installed SDK and current documentation; replace obsolete `@mariozechner/*` imports with supported APIs. Do not assume a namespace-only replacement is sufficient. Preserve skill names, activation descriptions, and safety instructions.

### Validation

- [x] Add focused regression tests for each fix, using disposable files and mocked models/processes; do not touch live configuration or private state.
- [x] Run `npm run check`, `npm test`, `npm run build:fleet-mcp`, and `git diff --check`. Run architecture tests for boundary changes and knip for changed exports/deletions. Report pre-existing warnings separately from regressions.
- [x] Complete targeted diagnostics where the broad review scan timed out; do not interpret partial scan results as a clean audit.

Implemented with bounded metadata reads in `file-metadata.ts`, shared Boost
restoration, bounded spawned-worker output, and UTF-8-safe Fleet truncation.
Validation: 100 focused tests and all 1,311 tests passed; repository checks
(including knip), architecture tests, Fleet build, and diff checks passed.
Both documented TypeScript examples typechecked against SDK 0.84.4. Targeted LSP
checks passed, including the previously inconclusive Python setup script.
The 12 existing lint warnings remain; live configuration and deployments are unchanged.

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
