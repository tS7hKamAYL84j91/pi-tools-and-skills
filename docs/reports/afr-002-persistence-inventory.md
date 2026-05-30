# AFR-002 Persistence Inventory

Date: 2026-05-30

## Scope

Inventory of direct filesystem mutation points in `extensions/` and `lib/` for AFR-002. The goal is to identify where shared persistence helpers should replace one-off writes, and where direct IO is an explicit exception.

## Categories

### Existing atomic-ish full-file writes

- `extensions/pi-coas/store.ts`
  - Has local `writeFileAtomic()` using temp file + exclusive write + rename.
  - Candidate to replace with shared `writeFileAtomic()`.
- `lib/session-spool.ts`
  - Has local temp write + rename + temp cleanup.
  - Candidate to replace with shared `writeFileAtomic()`.

### Direct full-file state writes needing shared helper

- `extensions/pi-goal/state.ts`
  - Writes goal state JSON, summary Markdown, TODO Markdown, iteration artifacts, and `.git/info/exclude`.
  - Goal state and generated artifacts should use shared atomic full-file writes.
- `extensions/pi-kanban/board.ts`
  - Writes task Markdown files and appends checklist entries by read/modify/write.
  - Task Markdown full-file writes should use shared atomic writes; checklist update is a read/update/write cycle.
- `extensions/pi-kanban/board-tools.ts`
  - Writes `snapshot.md`.
  - Candidate for shared atomic write.
- `extensions/pi-kanban/compaction.ts`
  - Writes backup archive and compacted board log.
  - Candidate for shared atomic write, with care around board log replacement semantics.
- `extensions/pi-matrix/attachments.ts`
  - Writes downloaded attachment bytes.
  - Candidate for shared atomic write for binary content.
- `extensions/pi-panopticon/registry/registry.ts`
  - Writes registry record JSON directly with `writeFileSync()`.
  - Candidate for sync or async shared atomic JSON write, or documented exception if lifecycle requires sync.
- `extensions/pi-panopticon/teams/team-form.ts`
  - Writes team and subagent Markdown files directly with `writeFileSync()`.
  - Candidate for sync or async shared atomic text writes.
- `lib/session-hook-installer.ts`
  - Writes hook state JSON directly.
  - Candidate for shared atomic write.

### Append-only logs needing shared helper

- `extensions/pi-coas/schedules.ts`
  - Appends scheduler log lines.
- `extensions/pi-coas/workspaces.ts`
  - Appends workspace journal/context sections.
- `extensions/pi-coas/scheduler.ts`
  - Appends scheduler log lines.
- `extensions/pi-kanban/board.ts`
  - Appends board events to `board.log`.

### Directory/removal/lock operations likely explicit exceptions

- Directory creation with `mkdir`/`mkdirSync` remains necessary before writes.
- Cleanup/removal calls in `lib/spawn-service.ts`, `extensions/pi-panopticon/spawner/spawner.ts`, `extensions/pi-panopticon/teams/worktree-isolation.ts`, and registry cleanup are lifecycle operations, not persistence writes.
- `extensions/pi-panopticon/teams/worktree-isolation.ts` uses directory creation/removal as a simple lock primitive; document as an advisory-lock exception rather than replacing with file write helpers.
- `lib/transports/maildir.ts` uses Maildir-specific sync writes and renames; keep as a protocol-specific exception unless a sync helper is added later.
- `lib/agent-registry.ts` currently manages shared agent registry directories synchronously; candidate for later helper adoption, but may remain an exception if pi lifecycle requires sync operations.

## Recommended first implementation slice

1. Add `lib/file-persistence.ts` with:
   - `writeFileAtomic(path, data, options?)`
   - `appendLogLine(path, line, options?)`
   - `updateJsonFile(path, update, options?)`
2. Migrate the lowest-risk async state writers first:
   - `extensions/pi-goal/state.ts`
   - `extensions/pi-kanban/board.ts` event append and task writes
   - `extensions/pi-kanban/board-tools.ts` snapshot write
3. Add a fitness test after migration that flags direct `writeFile`/`appendFile` in extension state files unless explicitly listed as an exception.

## Open design questions

- Whether to provide sync variants for lifecycle-sensitive code (`registry.ts`, `team-form.ts`, Maildir transport) or document them as exceptions for now.
- Whether JSON update helpers should include advisory locking immediately or remain atomic-write-only for the first slice.
- How broad the direct-write fitness test should be without becoming noisy for attachment downloads, worktree locks, and transport protocol files.
