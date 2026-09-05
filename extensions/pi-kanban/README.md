# Kanban Extension

A pi extension that turns an append-only `board.log` into a kanban board with 11 model-visible tools, an auto-refreshing TUI widget, log compaction, and gradual-disclosure snapshots.

`pi-kanban` is a reusable board/tooling/event surface. It does not own cron, recurring schedules, morning briefs, state capture cadence, recurring reviews, or CoAS operational policy; those belong in `pi-coas` schedules that may call `kanban_*` tools.

## Board Model

### Event Sourcing

`board.log` is the single source of truth. Every action appends one or more lines — the board is never mutated in place. `board.ts` replays all events on each read to materialise the current state.

**Event format:**

```
<ISO-8601-timestamp> <EVENT> <T-NNN> <agent> [key=value ...]
```

**Event types:**

| Event      | Written by          | Effect                                        |
|------------|---------------------|-----------------------------------------------|
| `CREATE`   | `kanban_create`     | Adds task to backlog                          |
| `MOVE`     | many tools          | Changes column                                |
| `CLAIM`    | `kanban_claim`      | Marks task claimed by agent (in-progress)     |
| `UNCLAIM`  | internal / reassign | Removes claim                                 |
| `EXPIRE`   | internal            | Clears expired claim                          |
| `COMPLETE` | `kanban_complete`   | Moves task to done, records duration          |
| `BLOCK`    | `kanban_block`      | Moves in-progress task to blocked             |
| `UNBLOCK`  | `kanban_unblock`    | Moves blocked task back to todo               |
| `NOTE`     | `kanban_edit`       | Appends timestamped note to task              |
| `EDIT`     | `kanban_edit`       | Updates title/priority/tags/description       |
| `DELETE`   | `kanban_delete`     | Soft-deletes task (excluded from snapshot)    |
| `COMPACT`  | `kanban_compact`    | Marks log rewrite checkpoint                  |
| `SNAPSHOT` | `kanban_snapshot`   | Records snapshot generation (seq number)      |

### Columns

```
backlog → todo → in-progress → done
                     ↕
                  blocked
```

Canonical lifecycle vocabulary is `backlog`, `todo`, `in-progress`, `blocked`, and `done`. Internal pure helpers live in `lifecycle.ts`; they do not migrate `board.log` or change runtime behavior.

WIP limit: **3** in-progress tasks (configurable via `KANBAN_WIP_LIMIT` env var).

### Directory

The extension locates the kanban directory by checking, in order:

1. `KANBAN_DIR` environment variable
2. `<cwd>/pi-kanban/`

The legacy unprefixed `<cwd>/kanban/` fallback has been removed.

## What this does NOT do

- Does not own cron, recurring schedules, morning briefs, state capture cadence, or CoAS operational policy.
- Does not implement portfolio governance, hierarchy, dependency graphs, or value-stream prioritization.
- Does not monitor or nudge agents; use Panopticon agent health tools for that.
- Does not inject full board contents automatically; snapshots and detail views are explicit.

Files written:

- `board.log` — event log (source of truth)
- `snapshot.md` — regenerated on `kanban_snapshot` with the same view requested: compact by default, full only for `detail="full"`, or one-card detail for `task_id`
- `board.log.bak.<timestamp>` — created before compaction

### Verification gate

`kanban_complete` enforces the documented owner check (`agent` must equal the task's `claimAgent`) before any write.

When a task is created with `verification_required=true`, or when `KANBAN_REQUIRE_CHECK_EVIDENCE=1` is set, completion requires a `checks` array of `{command, result, exit_code}` evidence. The tool hard-blocks (throws) if evidence is missing or any `exit_code` is not `0`. The evidence is persisted on the `COMPLETE` event, in `TaskState`, and in JSON export; task detail and snapshot views render it under **Verification evidence**.

This is an auditable evidence gate, not an execution verifier: the agent runs the check and reports the result.

Separately, an operator may set `KANBAN_GATE_COMMAND` before starting pi. When configured, `kanban_complete` runs that command in the active workspace and blocks completion on failure with bounded diagnostics. With no configured gate, completion behavior is unchanged. The public tool schema retains deprecated `gate_command` only as ignored compatibility input; its value is never executed and cannot select or override the trusted operator command.

## Stable Tools/Commands

External schedulers such as `pi-coas` may use the existing `kanban_*` tools as a board API, but `pi-kanban` does not own the cadence or policy that decides when to call them.

### Scheduler-safe surface

External schedulers such as `pi-coas` may use the existing `kanban_*` tools as a board API, but `pi-kanban` does not own the cadence or policy that decides when to call them.

| Scheduler need | Tool surface | Safe behavior |
| --- | --- | --- |
| Inspect board, backlog, todo, WIP, blocked, done | `kanban_snapshot` default compact view | Read-oriented summary plus `snapshot.md`; no recurring loop is started. |
| Inspect one card, full board, or older Done history when explicitly needed | `kanban_snapshot task_id="T-NNN"`, `detail="full"`, or `show_all_done=true` | Gradual disclosure keeps default context small; Done is age-filtered by default. |
| Start one authorized task | `kanban_claim agent=... task_id?` | With no `task_id`, picks highest-priority todo; returns `NO_TASK_AVAILABLE`, `WRONG_COLUMN`, `TASK_NOT_FOUND`, or `WIP_LIMIT_REACHED` without mutating on those failures. |
| Record progress | `kanban_edit note=...` | Notes can be appended to any task; metadata edits remain limited to backlog/todo. |
| Block or complete work | `kanban_block`, `kanban_complete` | Require in-progress tasks and record auditable events. |
| Move planning items | `kanban_move` | Only backlog ↔ todo; no scheduler policy is embedded. |

Schedulers should treat `details.result` from `kanban_claim` as the idempotency/error signal and should not retry blindly when WIP or column guards reject a claim.

### Task Management

| Tool              | Parameters                                      | Notes                                          |
|-------------------|-------------------------------------------------|------------------------------------------------|
| `kanban_create`   | `task_id`, `agent`, `title`, `priority`, `tags?`, `description?` | Creates in backlog. task_id must be unique T-NNN |
| `kanban_claim`    | `task_id?`, `agent`, `model?`                   | Claims specific task, reassigns in-progress, or automatically picks highest-priority todo if task_id is omitted |
| `kanban_complete` | `task_id`, `agent`, `duration?`, `checks?`      | Marks in-progress task done; may enforce the operator-configured environment gate |
| `kanban_block`    | `task_id`, `agent`, `reason`                    | Moves in-progress task to blocked, frees WIP   |
| `kanban_unblock`  | `task_id`, `agent`, `reason?`                   | Moves blocked task back to todo                |
| `kanban_move`     | `task_id`, `agent`, `to`                        | Moves between backlog and todo only            |
| `kanban_edit`     | `task_id`, `agent`, `title?`, `priority?`, `tags?`, `description?`, `note?` | Edits backlog/todo task metadata, or appends a progress note to any task |
| `kanban_delete`   | `task_id`, `agent`, `reason?`                   | Soft-deletes backlog/todo/done tasks           |
| `kanban_export_json` | none                                         | Read-only JSON export of active tasks/counts   |

### Board Operations

| Tool               | Parameters         | Notes                                                                |
|--------------------|--------------------|----------------------------------------------------------------------|
| `kanban_snapshot`  | `detail?`, `task_id?`, `show_all_done?` | Regenerates `snapshot.md`; returns compact summary by default, `detail="full"` for full board, `task_id="T-NNN"` for one card, or `show_all_done=true` to include older Done tasks |
| `kanban_compact`   | _(none)_           | Manual log compaction; creates timestamped backup                    |

### Priority Order

`kanban_claim` without `task_id` selects by: `critical → high → medium → low`, then by lowest T-NNN number within the same priority.

Display views use the same priority direction for active columns (`backlog`, `todo`, `in-progress`, and `blocked`). The `/kanban` header shows a fixed `priority ↓` indicator; it is informational, not a manual sort control. Equal priorities retain canonical board order, so filtering and live refreshes remain deterministic. Priority matching is case-insensitive for legacy values; missing, empty, and unknown values sort after `low` and retain canonical order among themselves. Done is excluded from this sort: its existing recent-first bounded view and age/window behavior are unchanged. Display ordering does not add a rank field or change claim, WIP, or board events.

### Feature/epic tag convention

Use the existing comma-separated `tags` field for lightweight feature or epic grouping. Canonical tags are lowercase slug prefixes:

- `feature:<slug>` — capability or value-stream grouping, e.g. `feature:research-tools`
- `epic:<slug>` — larger initiative grouping, e.g. `epic:coas-kanban-boundary`

Examples:

```text
kanban_create task_id=T-557 agent=lead title="Document feature tags" priority=medium tags="feature:kanban-metadata,epic:operator-followthrough"
kanban_edit task_id=T-557 agent=lead tags="feature:kanban-metadata,docs"
```

Rules:

- Feature/epic tags are orthogonal to priority, column/status, owner, and WIP.
- Generic tags remain valid; untagged tickets continue to use an empty tag string / `tags: []` task-file frontmatter.
- `pi-kanban` stores tags as metadata only. It does not implement portfolio governance, hierarchy, dependency graphs, scheduling policy, or value-stream prioritization.
- Prefer lowercase kebab-case slugs after the prefix. The current tool surface preserves unknown/generic tag values rather than rejecting them.

## Board Themes

The `/kanban` overlay follows pi's active TUI theme by default. Set `KANBAN_BOARD_THEME` for a small board-specific remap:

| Value | Behavior |
| ----- | -------- |
| `default` | Use pi theme colors unchanged |
| `focus` | Stronger active-column/border emphasis for projection or busy boards |
| `mono` | Reduce semantic colors to text/dim for low-color terminals |

Example:

```bash
KANBAN_BOARD_THEME=focus pi
```

## Watcher

`watcher.ts` watches `board.log` for filesystem changes and runs two paths:

### Fast Path (every change)

Updates the TUI widget immediately — no LLM involved:

```
pi-kanban: wip 2/3 | todo 4 | blocked 1 | done 12
  T-042 Implement OAuth (tools-worker)
  T-051 Write tests (test-runner)
```

The status bar is intentionally left empty because the widget already shows the WIP/todo/blocked/done breakdown.

This watcher is event-driven board-change notification only. It is not a recurring scheduler and must not grow cron or business-policy ownership.

### Slow Path (opt-in: external board change + idle + cooldown)

Automatic `followUp` injection is **off by default** to keep sessions quiet. The setting is persisted under `kanban.watchNotifications` in standard Pi `settings.json` (global settings, with trusted project `.pi/settings.json` overriding it). Toggle it at runtime with `/kanban-watch on|off`; agents can use the `kanban_watch` tool with `action` `on`, `off`, or `status`. Widget and status updates remain enabled regardless. `KANBAN_WATCHER_AUTO_FOLLOW_UP=1` remains a temporary startup opt-in.

When enabled, external board changes inject a `followUp` message to the LLM orchestrator:

```
Board updated externally (kanban watcher detected new events).
Run kanban_snapshot for a compact board summary.
Use task_id="T-NNN" or detail="full" only when explicit details are needed.
...
```

**Injection safeguards:**

- Disabled by default; controlled by persisted `kanban.watchNotifications`, `/kanban-watch`, or `kanban_watch`
- Only fires when `ctx.isIdle()` (agent not mid-turn)
- **5-minute cooldown** between injections
- **Max 3 consecutive** auto-injections without human input
- Counter resets on `agent_end` (human or LLM finishes a turn)
- Self-writes (tools writing to board.log) are excluded via `selfAppendedLines` set

## Auto-Compaction

Triggered automatically after `kanban_complete` and `kanban_snapshot` if either threshold is exceeded:

| Threshold        | Value | Description                                      |
|------------------|-------|--------------------------------------------------|
| Absolute size    | 500   | `totalLines > 500`                               |
| Dirty ratio      | 2.0×  | `totalLines / estimatedCompactedLines > 2.0`     |

**What compaction preserves:**

- All non-deleted tasks (reconstructed from current state)
- Full BLOCK/UNBLOCK history (diagnostic value)
- All notes for non-done tasks
- Notes ≤7 days old for done tasks

**What it drops:**

- Superseded MOVE/CLAIM/UNCLAIM events (only final state kept)
- Notes >7 days old for completed tasks

**Output:** A backup `board.log.bak.<timestamp>` plus a rewritten `board.log` ending with a `COMPACT` marker recording `events_before` and `events_after`.

## Snapshot Output

`kanban_snapshot` writes and returns a compact summary by default:

```markdown
# Kanban — Compact Summary
_Generated: ... | Log events: 247 | WIP: 2/3_
_Gradual disclosure: task descriptions/notes are not included here..._

## 📋 Backlog (N)
- T-101: Short title

## 🔄 In Progress (N/3)
- T-042: Implement OAuth — tools-worker
```

Done is age-filtered to tasks completed in the last 30 days by default. Older completed tasks stay recoverable from `board.log` and can be shown explicitly.

Full detail remains available on demand:

- `kanban_snapshot({ "detail": "full" })` — returns the full board, including descriptions and notes, with default Done-age filtering.
- `kanban_snapshot({ "show_all_done": true })` — includes older completed tasks in the returned view and regenerated `snapshot.md`.
- `kanban_snapshot({ "task_id": "T-NNN" })` — returns full detail for one card, including older Done tasks by id.
- `/kanban` — opens the live TUI overlay, which remains bounded to the most recent Done cards.
- `pi-kanban/tasks/T-NNN.md` — per-task markdown file for direct reads.

`pi-kanban/snapshot.md` retains the compact view by default. A full five-column Markdown board is written only when explicitly requested with `detail="full"`:

```markdown
# Kanban — Snapshot
_Generated: ... | Log events: 247 | WIP: 2/3_

## 📋 Backlog (N)
| ID | Title | Priority | Tags |
...

## 🔄 In Progress (N/3)
| ID | Title | Agent | Model | Expires |
...
```

Notes and descriptions appear only in explicit full-board or task-detail views, and are persisted to `snapshot.md` only when that explicit view is requested.

## Task Files

Each new ticket gets a persistent markdown file at `pi-kanban/tasks/T-NNN.md` with YAML frontmatter and a notes section. This supplements board.log (which remains the source of truth) with a per-task document suitable for extended context.

**Created by:** `kanban_create`
**Updated by:** `kanban_edit` (appends notes or rewrites frontmatter)

**Format:**

```markdown
---
title: "Task title here"
priority: high
tags: [kanban, architecture]
agent: worker-name
created: 2026-04-09T15:00:00Z
---

## Notes

- 2026-04-09T15:05:00Z [agent-name] Progress update here
```

**Behaviour:**

- Existing tickets (created before this feature) do not get migrated — only new tickets written via `kanban_create` produce task files.
- `kanban_edit` creates a stub file if one doesn't already exist when adding a note.
- `kanban_edit` preserves existing notes and the original `created` timestamp when rewriting frontmatter.

## Provisional Surfaces

- Auto-compaction heuristics
- Task file generation and bidirectional sync

## Cross-Extension Dependencies

- Interacts with `pi-coas` schedulers indirectly via safe board APIs.
- Integrates with pi core for TUI theming (`KANBAN_BOARD_THEME`).

## File Layout

```
project-extensions/pi-kanban/
  board.ts       Types (TaskState, BoardState), path helpers, parseBoard(), logAppend(), task file I/O
  index.ts       Tools + auto-compaction (runCompaction, compactIfNeeded)
  snapshot.ts    generateSnapshotSummary(), generateTaskDetail(), generateSnapshot() — pure functions, no side effects
  watcher.ts     setupWatcher() — TUI widget, status bar, injection gates
  tasks/         Per-task markdown files (T-NNN.md) — created by kanban_create
```
