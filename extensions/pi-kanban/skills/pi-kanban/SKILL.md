---
name: pi-kanban
description: Authorized Kanban board interactions to view, create, claim, update, complete, and explicitly compact tasks.
---

# Pi Kanban

Use only for requested, authorized board work. Follow project restrictions on
board access; do not sweep, claim or update as startup work or duplicate agent
execution records. Gravitas owns this repository's optional human overview.

## Operations

- `/kanban`: live board and task-detail view.
- `kanban_export_json`: read-only structured board data.
- `kanban_create task_id={{T-NNN}} agent={{name}} title={{title}} priority={{critical|high|medium|low}}`: create in backlog.
- `kanban_move task_id={{T-NNN}} agent={{name}} to=todo`: make claimable.
- `kanban_claim agent={{name}}`: claim highest-priority todo task, lowest ID on ties.
- `kanban_claim task_id={{T-NNN}} agent={{name}}`: claim a todo task or explicitly reassign in-progress work.
- `kanban_edit task_id={{T-NNN}} agent={{name}} note={{update}}`: append a note.
- `kanban_edit task_id={{T-NNN}} agent={{name}} title={{title}} priority={{priority}} tags={{tags}} description={{text}}`: edit backlog/todo metadata.
- `kanban_block` / `kanban_unblock`: record or resolve a blocker with task ID, agent and reason.
- `kanban_complete task_id={{T-NNN}} agent={{name}} duration={{45m|2h}}`: complete owned in-progress work with required check evidence.
- `kanban_compact`: explicitly compact history, retaining an original-log backup.

Viewing and completion never compact. Markdown snapshots/export are removed;
do not delete existing artifacts or rewrite historical events. Compaction stays
an explicit operation, not an inspection side effect.

## Safeguards

Task IDs use `T-NNN`. WIP defaults to three. Metadata edits require backlog/todo;
notes can be added to existing tasks. In-progress tasks cannot be deleted; blocked
deletion requires confirmation. Task Markdown supplements authoritative board.log.
Preserve owner checks, WIP limits, verification evidence, trusted completion gates,
confirmation, locks and backups. Use `agent_status`, not Kanban, for agent health.
