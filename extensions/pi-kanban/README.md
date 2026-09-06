# Kanban Extension

An optional human-facing board backed by an append-only `board.log`, with a TUI
and explicit tools. It is not an agent execution workflow. Follow the project's
board-access policy; in this repository Gravitas owns the optional overview.

## View, export, compact

These are separate operations:

| Operation | Tool | Effects |
| --- | --- | --- |
| View board or task | `kanban_snapshot` | Read-only Markdown result; no file writes, events, backups or compaction |
| Read structured data | `kanban_export_json` | Read-only JSON result; no file writes or events |
| Export Markdown | `kanban_export` | Writes `snapshot.md` and appends one SNAPSHOT event under the board lock |
| Compact history | `kanban_compact` | Explicitly backs up and rewrites `board.log` under the board lock |

Viewing and completing tasks never trigger compaction. `snapshot.md` is an
explicitly exported artifact, not the live board authority.

Both `kanban_snapshot` and `kanban_export` accept:

- No options: compact summary, with bounded recent Done items.
- `detail="full"`: full board view and task details.
- `task_id="T-NNN"`: one card, including older completed cards.
- `show_all_done=true`: include older Done history instead of age filtering.

Use compact views first and request additional detail only when needed.

## Board model and storage

`board.log` is authoritative. Events materialize task state on each read; writes
are serialized through board transactions.

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

- `board.log`: event history and authoritative task state.
- `tasks/T-NNN.md`: task descriptions/notes written by create/edit operations.
- `snapshot.md`: Markdown written only by `kanban_export`.
- `archive/board.log.bak.<timestamp>-<unique-id>`: backups from explicit compaction.

Task files supplement the log; they do not establish a second execution record.
Existing task descriptions and creation timestamps survive note updates.

## Tools

| Tool | Purpose |
| --- | --- |
| `kanban_create` | Create a unique `T-NNN` task in backlog |
| `kanban_claim` | Claim a specified/next todo task or reassign an in-progress task |
| `kanban_complete` | Complete an owned in-progress task, enforcing configured checks |
| `kanban_block` / `kanban_unblock` | Record a blocker or return a blocked task to todo |
| `kanban_move` | Move backlog ↔ todo; not a shortcut around claim/completion guards |
| `kanban_edit` | Change backlog/todo metadata or append a note |
| `kanban_delete` | Soft-delete eligible tasks; blocked deletion requires confirmation |
| `kanban_snapshot` | View board/task data without changing files |
| `kanban_export_json` | Return structured board data without changing files |
| `kanban_export` | Explicitly write a Markdown snapshot and its audit event |
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
- `/kanban-watch on|off`: configure board-change follow-ups.
- `KANBAN_BOARD_THEME`: `default`, `focus`, or `mono`; this changes display only.

The widget updates on file changes without invoking an LLM. Automatic follow-up
messages are off by default. The `kanban.watchNotifications` setting is read from
Pi settings, with trusted project settings overriding global settings.
`KANBAN_WATCHER_AUTO_FOLLOW_UP=1` remains an explicit startup opt-in.

When enabled, follow-ups are idle-gated and cooldown-limited, and self-writes are
excluded. They request a read-only `kanban_snapshot`; they do not claim work or
perform housekeeping. Health monitoring belongs to Panopticon, not this board.

## What this does NOT do

- Does not require agents to maintain a board before doing authorized work.
- Does not own recurring schedules, morning briefs, reviews or operational policy.
- Does not add hierarchy, dependency graphs or portfolio governance.
- Does not compact automatically during viewing, exporting or completion.
- Does not bypass ownership, WIP, verification, completion gates or confirmations.
- Does not inject full board/task contents automatically into model context.
