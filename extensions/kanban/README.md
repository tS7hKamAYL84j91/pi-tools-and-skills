# Kanban Extension

A pi extension that turns an append-only `board.log` into a kanban board with 14 tools, an auto-refreshing TUI widget, autonomous monitoring, log compaction, and gradual-disclosure snapshots.

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
| `CLAIM`    | `kanban_pick/claim` | Marks task claimed by agent (in-progress)     |
| `UNCLAIM`  | internal / reassign | Removes claim                                 |
| `EXPIRE`   | internal            | Clears expired claim                          |
| `COMPLETE` | `kanban_complete`   | Moves task to done, records duration          |
| `BLOCK`    | `kanban_block`      | Moves in-progress task to blocked             |
| `UNBLOCK`  | `kanban_unblock`    | Moves blocked task back to todo               |
| `NOTE`     | `kanban_note`       | Appends timestamped note to task              |
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

WIP limit: **3** in-progress tasks (configurable via `KANBAN_WIP_LIMIT` env var).

### Directory

The extension locates the kanban directory by checking, in order:
1. `KANBAN_DIR` environment variable
2. `~/git/coas/kanban/`
3. `<cwd>/kanban/`

Files written:
- `board.log` — event log (source of truth)
- `snapshot.md` — regenerated on `kanban_snapshot`
- `monitor.log` — appended by `kanban_monitor`
- `board.log.bak.<timestamp>` — created before compaction

## Tools Reference

### Task Management

| Tool              | Parameters                                      | Notes                                          |
|-------------------|-------------------------------------------------|------------------------------------------------|
| `kanban_create`   | `task_id`, `agent`, `title`, `priority`, `tags?`, `description?` | Creates in backlog. task_id must be unique T-NNN |
| `kanban_pick`     | `agent`, `model?`                               | Claims highest-priority todo task; returns `NO_TASK_AVAILABLE` or `WIP_LIMIT_REACHED` |
| `kanban_claim`    | `task_id`, `agent`, `model?`                    | Claims a specific task from todo               |
| `kanban_complete` | `task_id`, `agent`, `duration?`                 | Marks in-progress task done                    |
| `kanban_block`    | `task_id`, `agent`, `reason`                    | Moves in-progress task to blocked, frees WIP   |
| `kanban_unblock`  | `task_id`, `agent`, `reason?`                   | Moves blocked task back to todo                |
| `kanban_note`     | `task_id`, `agent`, `text`                      | Appends timestamped note                       |
| `kanban_move`     | `task_id`, `agent`, `to`                        | Moves between backlog and todo only            |
| `kanban_edit`     | `task_id`, `agent`, `title?`, `priority?`, `tags?`, `description?` | Edits backlog/todo tasks only |
| `kanban_delete`   | `task_id`, `agent`, `reason?`                   | Soft-deletes backlog/todo/done tasks           |
| `kanban_reassign` | `task_id`, `agent`, `new_agent`, `model?`       | Transfers in-progress task to new agent        |

### Board Operations

| Tool               | Parameters         | Notes                                                                |
|--------------------|--------------------|----------------------------------------------------------------------|
| `kanban_snapshot`  | `detail?`, `task_id?` | Regenerates full `snapshot.md`; returns compact summary by default, `detail="full"` for full board, or `task_id="T-NNN"` for one card |
| `kanban_compact`   | _(none)_           | Manual log compaction; creates timestamped backup                    |
| `kanban_monitor`   | `prod?`            | Checks all in-progress tasks; nudges stalled agents when `prod=true` |

### Priority Order

`kanban_pick` selects by: `critical → high → medium → low`, then by lowest T-NNN number within the same priority.

## Watcher

`watcher.ts` watches `board.log` for filesystem changes and runs two paths:

### Fast Path (every change)
Updates the TUI widget immediately — no LLM involved:
```
📋 WIP 2/3 | todo 4 | blocked 1 | done 12
  T-042 Implement OAuth (tools-worker)
  T-051 Write tests (test-runner)
```

Also updates the status bar: `📋 WIP 2/3 | 1 blocked`

### Slow Path (COMPLETE/BLOCKED detected + idle + cooldown)
Injects a `followUp` message to the LLM orchestrator:
```
Board updated externally (kanban watcher detected new events).
Run kanban_snapshot for a compact board summary.
Run kanban_monitor and agent_status to check agent health.
Use task_id="T-NNN" or detail="full" only when explicit details are needed.
...
```

**Injection safeguards:**
- Only fires when `ctx.isIdle()` (agent not mid-turn)
- **5-minute cooldown** between injections
- **Max 3 consecutive** auto-injections without human input
- Counter resets on `agent_end` (human or LLM finishes a turn)
- Self-writes (tools writing to board.log) are excluded via `selfAppendedLines` set

**Commands:**
- `/monitor-reset` — reset injection counter (resume after pause)
- `/monitor-pause` — pause injections (widget updates continue)

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

## Monitor

`kanban_monitor` inspects each in-progress task's agent and reports its liveness:

1. **Registry lookup** — finds agent by name in panopticon registry
2. **PID check** — if process not running → `MISSING`
3. **Heartbeat age** — if >5 minutes stale → `STALLED`; otherwise → `ACTIVE`

Tasks in the `blocked` column surface as `BLOCKED`.

With `prod=true` (or `--prod` CLI flag): sends a nudge via panopticon Maildir to stalled agents.

**Philosophy — no filesystem watching.** The monitor does not poll for `REPORT.md` or any other side-effect artefact. Task completion is signalled *explicitly* by the agent calling `kanban_complete`. This avoids the race conditions and ambiguity of inferring state from files on disk.

## Snapshot Output

`kanban_snapshot` always writes full `snapshot.md` with five columns, but the tool result returned to the model is compact by default:

```markdown
# CoAS Kanban — Compact Summary
_Generated: ... | Log events: 247 | WIP: 2/3_
_Gradual disclosure: task descriptions/notes are not included here..._

## 📋 Backlog (N)
- T-101: Short title

## 🔄 In Progress (N/3)
- T-042: Implement OAuth — tools-worker
```

Full detail remains available on demand:

- `kanban_snapshot({ "detail": "full" })` — returns the full board, including descriptions and notes.
- `kanban_snapshot({ "task_id": "T-NNN" })` — returns full detail for one card.
- `/kanban` — opens the full live TUI overlay.
- `kanban/tasks/T-NNN.md` — per-task markdown file for direct reads.

`kanban/snapshot.md` retains the full five-column Markdown board:

```markdown
# CoAS Kanban — Snapshot
_Generated: ... | Log events: 247 | WIP: 2/3_

## 📋 Backlog (N)
| ID | Title | Priority | Tags |
...

## 🔄 In Progress (N/3)
| ID | Title | Agent | Model | Expires |
...
```

Notes and descriptions appear only in explicit detail views or the written snapshot file.

## Task Files

Each new ticket gets a persistent markdown file at `kanban/tasks/T-NNN.md` with YAML frontmatter and a notes section. This supplements board.log (which remains the source of truth) with a per-task document suitable for extended context.

**Created by:** `kanban_create`
**Updated by:** `kanban_note` (appends note), `kanban_edit` (rewrites frontmatter)

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
- `kanban_note` creates a stub file if one doesn't already exist for the task.
- `kanban_edit` preserves existing notes and the original `created` timestamp when rewriting frontmatter.

## File Layout

```
project-extensions/kanban/
  board.ts       Types (TaskState, BoardState), path helpers, parseBoard(), logAppend(), task file I/O
  index.ts       14 tools + auto-compaction (runCompaction, compactIfNeeded)
  monitor.ts     getInProgressTasks, inspectAgent, deliverNudge, formatMonitorReport
  snapshot.ts    generateSnapshotSummary(), generateTaskDetail(), generateSnapshot() — pure functions, no side effects
  watcher.ts     setupWatcher() — TUI widget, status bar, injection gates
  tasks/         Per-task markdown files (T-NNN.md) — created by kanban_create
```
