---
name: pi-kanban
description: Kanban board interactions to create, claim, update, snapshot, and complete tasks on a shared event-sourced task board.
---

# Pi Kanban

Use this skill only for requested, authorized board work. It is a tool reference,
not a requirement to track implementation in Kanban. Follow project-specific
restrictions on who may access the board; do not sweep, claim, or update it as
startup work or duplicate execution records.

## Board lifecycle reference

```text
kanban_create → kanban_move to=todo → kanban_claim → kanban_edit note=... → kanban_complete
```

## Common operations

- Create a task in backlog:
  `kanban_create task_id={{T-NNN}} agent={{name}} title={{title}} priority={{critical|high|medium|low}}`

- Move a backlog task to todo:
  `kanban_move task_id={{T-NNN}} agent={{name}} to=todo`

- Claim a specific todo task:
  `kanban_claim task_id={{T-NNN}} agent={{name}}`

- Pick the next claimable task automatically:
  `kanban_claim agent={{name}}`

- Reassign an in-progress task:
  `kanban_claim task_id={{T-NNN}} agent={{new-agent}}`

- Add a progress note:
  `kanban_edit task_id={{T-NNN}} agent={{name}} note={{update}}`

- Edit backlog/todo metadata:
  `kanban_edit task_id={{T-NNN}} agent={{name}} title={{title}} priority={{priority}} tags={{tags}} description={{text}}`

- Block or unblock work:
  `kanban_block task_id={{T-NNN}} agent={{name}} reason={{reason}}`
  `kanban_unblock task_id={{T-NNN}} agent={{name}} reason={{reason}}`

- Complete a task:
  `kanban_complete task_id={{T-NNN}} agent={{name}} duration={{45m|2h}}`

- View board state with gradual disclosure:
  `kanban_snapshot`
  `kanban_snapshot task_id={{T-NNN}}`
  `kanban_snapshot detail=full`

## Patterns

- `kanban_claim` is the single assignment operation:
  - omit `task_id` to pick the highest-priority todo task;
  - pass a todo `task_id` to claim it;
  - pass an in-progress `task_id` with a new agent to reassign it.
- `kanban_edit` is the single update operation for metadata and notes.
- Use `kanban_snapshot` first; request `task_id` or `detail=full` only when more context is needed.
- Use `agent_status` for agent health; kanban no longer has a monitor/nudge tool.

## Gotchas

- Task IDs must match `T-NNN` exactly.
- WIP limit is 3 in-progress tasks.
- Metadata edits are allowed only for backlog/todo tasks; notes can be added to any existing task.
- `kanban_complete` only works on in-progress tasks.
- `kanban_delete` can delete blocked tasks after confirmation; it cannot delete in-progress tasks.
- Each created task gets `pi-kanban/tasks/T-NNN.md`; notes append there as well as to `board.log`.
- Preserve owner checks, configured WIP limits, verification evidence, completion
  gates, and deletion confirmation. Optional board use does not bypass its safeguards.
