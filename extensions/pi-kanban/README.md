# Pi Kanban Extension

An optional human-facing board backed by an append-only `board.events.jsonl`, with a TUI
and explicit tools. It is not an agent execution workflow. Follow the project's
board-access policy; in this repository Gravitas owns the optional overview.

## View and compact

| Operation | Surface | Effects |
| --- | --- | --- |
| View board or task | `/kanban` live overlay | Viewing is read-only; mutations require explicit actions |
| Read structured data | `kanban_export_json` | Read-only JSON result; no file writes or events |
| Compact history | `kanban_compact` | Explicitly backs up and rewrites `board.events.jsonl` under the board lock |

Viewing and completing tasks never trigger compaction. Markdown snapshots and
export tools have been removed. Existing `snapshot.md` artifacts are left intact;
legacy `SNAPSHOT` log lines are not typed events, so they are skipped (and counted).
Unknown event versions are never skipped: a line whose `v` is newer than this
build aborts the read (`KanbanEventVersionError`) rather than report stale state;
malformed lines at a known version are surfaced as `skippedEvents` in
`kanban_export_json`.

## Board model and storage

`board.events.jsonl` is authoritative. Each line is one versioned (`v: 1`) typed
JSON event — `create | move | claim | unclaim | expire | complete | block |
unblock | note | delete | edit`. Events replay in order to materialize task
state on each read; writes are serialized through board transactions.

Legacy text `board.log` is no longer read. Migrate an existing board once with
`node scripts/migrate-kanban-log.mjs <kanbanDir>`, which writes the typed log and
archives the old one under `archive/`.

```text
backlog → todo → in-progress → done
                     ↕
                  blocked
```

Active tasks sort by priority (`critical`, `high`, `medium`, `low`) with original
board order as the tie-breaker. Missing/unknown priorities sort last. Done remains
recent-first. WIP defaults to three in-progress tasks, configurable through
`KANBAN_WIP_LIMIT`.

The board directory resolves from `KANBAN_DIR`, then `<cwd>/pi-kanban/`. There is
no automatic directory creation from viewing.

- `board.events.jsonl`: event history and authoritative task state.
- `tasks/T-NNN.md`: task descriptions/notes written by create/edit operations.
- `archive/board.events.jsonl.bak.<timestamp>-<unique-id>`: backups from explicit compaction.

Task files supplement the log; they do not establish a second execution record.
Existing task descriptions and creation timestamps survive note updates.

## Tools

| Tool | Purpose |
| --- | --- |
| `kanban_create` | Create a unique `T-NNN` task in backlog (optional `discovered_from: T-NNN` provenance link) |
| `kanban_claim` | Claim a specified/next todo task or reassign an in-progress task |
| `kanban_complete` | Complete an owned in-progress task, enforcing configured checks |
| `kanban_block` / `kanban_unblock` | Record a blocker or return a blocked task to todo |
| `kanban_move` | Move backlog ↔ todo; not a shortcut around claim/completion guards |
| `kanban_edit` | Change backlog/todo metadata or append a note |
| `kanban_delete` | Soft-delete eligible tasks; blocked deletion requires confirmation |
| `kanban_export_json` | Return structured board data without changing files |
| `kanban_compact` | Explicitly compact the board with a unique backup |
| `kanban_watch` | Inspect or configure board-change follow-up notifications |

Claims without `task_id` choose the highest-priority todo task, then lowest numeric
ID. Claim results distinguish no work, wrong column, missing task, and WIP limits;
do not retry rejected claims blindly. In-progress tasks cannot be deleted.

## Verification and safety gates

`kanban_complete` requires the supplied agent to match the current claimed owner.
The check is repeated inside the completion transaction after any trusted gate.

When evidence is required by task state or `KANBAN_REQUIRE_CHECK_EVIDENCE=1`,
completion requires passing `checks` entries with command, result and exit code.
Explicitly supplied failed checks also prevent completion. Check evidence is
preserved in completion events, exported task data and compacted completed tasks.

An operator may configure `KANBAN_GATE_COMMAND` before Pi starts. Completion runs
that trusted command and blocks on failure. The deprecated model-supplied
`gate_command` field is ignored and cannot choose or override the trusted gate.

Deleting the board's history is not part of viewing or task completion. Explicit
compaction backs up the original bytes before replacing the log. It preserves
current non-deleted tasks, BLOCK/UNBLOCK history, all notes for unfinished tasks,
and the last seven days of completed-task notes. Older details remain in backups.

## TUI and notifications

- `/kanban` or Ctrl+Shift+K: open the live board overlay.
- Overlay keys: `← →` column, `↑ ↓` row, `/` filter, `enter` detail, `c` claim
  (selected todo task, else next eligible), `x` complete an owned in-progress
  task, `n` new task (backlog, medium priority), `b` block with reason, `u`
  unblock, `m` move, `d` delete, `t` cycle theme, `esc/q` close.
- Overlay actions run the same transactions and orchestration as the tools: WIP
  limits, claim ownership, and check-evidence requirements are enforced by the
  shared board actions. Completion shares one path (`orchestrateTaskCompletion`):
  a configured `KANBAN_GATE_COMMAND` **runs** from the overlay and its failure
  denies completion; verification-evidence-required completion is denied from
  the overlay (it cannot supply checks) with the shared validation message.
- Overlay claims never reassign: a stale selection that another actor claimed
  in the meantime is denied inside the locked transaction (`claimOnly`), so
  the overlay cannot steal work. One board mutation runs at a time — repeated
  keys while an operation is pending are rejected as busy — and closing the
  overlay aborts an in-flight gate without committing (events already appended
  to board.events.jsonl are retained).
- Overlay mutations are recorded under the `KANBAN_OVERLAY_AGENT` identity
  (default `operator`). This is an audit label for attribution, not an
  authenticated identity; set it to attribute human board actions accurately.
- Creation allocates the next free id under the board lock. A task-file write
  failure is reported as a partial success (the board log is authoritative);
  do not retry creation.
- Deletion confirms only on explicit `y` (no Enter); moving to the task's
  current column is a guarded no-op. The header's live indicator is truthful:
  it shows `not live` while the log is unwatchable or unreadable and recovers
  when parsing succeeds again; local actions still refresh the view.
- Inline prompts embed Pi's native text input (cursor editing, word
  operations, undo, bracketed paste). The board renders a bounded row window
  with per-column scrolling; long detail content scrolls with `↑ ↓`.
- `/kanban-watch on|off`: configure board-change follow-ups.
- `KANBAN_BOARD_THEME`: `default`, `focus`, or `mono`; also cycleable in-session
  with `t`. This changes display only.

The widget updates on file changes without invoking an LLM. Automatic follow-up
messages are off by default. The `kanban.watchNotifications` setting is read from
Pi settings, with trusted project settings overriding global settings.
`KANBAN_WATCHER_AUTO_FOLLOW_UP=1` remains an explicit startup opt-in.

When enabled, follow-ups are idle-gated and cooldown-limited, and self-writes are
excluded. They recommend the live overlay or read-only JSON export; they do not claim work or
perform housekeeping. Health monitoring belongs to Agent Hub, not this board.

## What this does NOT do

- Does not require agents to maintain a board before doing authorized work.
- Does not own recurring schedules, morning briefs, reviews or operational policy.
- Does not add hierarchy, dependency graphs or portfolio governance.
- Does not compact automatically during viewing, exporting or completion.
- Does not bypass ownership, WIP, verification, completion gates or confirmations.
- Does not inject full board/task contents automatically into model context.
