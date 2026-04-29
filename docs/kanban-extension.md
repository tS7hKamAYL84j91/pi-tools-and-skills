# Kanban Extension Architecture

C4-style component model for the kanban extension and its gradual-disclosure context path.

```mermaid
flowchart TD
  User[Human / orchestrator] --> Pi[pi agent session]
  Pi --> Tools[Kanban tool adapters]
  Pi --> Watcher[board.log watcher]
  Pi --> Overlay[/kanban TUI overlay]

  Tools --> Board[board.ts event-sourced board model]
  Watcher --> Board
  Overlay --> Board
  Board --> Log[(kanban/board.log)]
  Board --> Tasks[(kanban/tasks/T-NNN.md)]

  Tools --> Snapshot[snapshot.ts renderers]
  Snapshot --> Compact[Compact summary\nIDs + short status only]
  Snapshot --> TaskDetail[Single-card detail\nrequested by task_id]
  Snapshot --> Full[Full board detail\nrequested by detail=full]
  Snapshot --> SnapshotFile[(kanban/snapshot.md\nfull board)]

  Watcher --> Injection[followUp message\ncompact guidance only]
  Injection --> Pi
  Pi -->|default kanban_snapshot| Compact
  Pi -->|explicit task_id| TaskDetail
  Pi -->|explicit detail=full or /kanban| Full
```

## Context policy

- Watcher reconciliation injects guidance only; it does not inject board contents.
- `kanban_snapshot` defaults to compact output: counts, card IDs, short titles/owners, no descriptions or notes.
- Full board and single-card details are explicit on-demand views.
- The full `snapshot.md` is still regenerated for humans and direct reads.
