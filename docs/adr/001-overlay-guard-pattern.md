# ADR 001: Overlay Guard Pattern for Restricted Actions

## Status

Accepted

## Context

The kanban TUI overlay allows keyboard actions (delete via `d`, move via `m`) on any task regardless of column. However, the backend enforces column restrictions:
- `moveTask` only works for `backlog` and `todo` columns
- `deleteTask` only works for columns other than `in-progress` and `blocked`

Previously, pressing `d` or `m` on a restricted task would enter a confirmation/picker screen, only to fail with an error after the user confirmed. This is a poor UX pattern — it teases an action that cannot succeed.

## Decision

Guard entry to restricted actions in the overlay controller (`overlay.ts` → `handleBoardInput`):

1. **Delete (`d`)**: Only enter confirm-delete for tasks in `backlog`, `todo`, or `done`. For `in-progress` tasks, set status message "Delete unavailable: complete the task first". For `blocked` tasks, "Delete unavailable: unblock the task first".

2. **Move (`m`)**: Only enter move-picker for tasks in `backlog` or `todo`. For `in-progress`, `blocked`, or `done` tasks, set status message "Move unavailable: {col} tasks cannot be moved".

This pattern matches the existing controller-level guard for keyboard actions and uses the same `statusMessage` mechanism (currently only used for async mutation errors).

## Consequences

- Users get immediate feedback when an action is unavailable, rather than discovering it after navigating a confirmation screen.
- The guard logic in the overlay must stay in sync with backend validation. If `deleteTask` or `moveTask` restrictions change, the overlay guards must be updated too.
- Status messages are transient — they display until the next render cycle clears them through a successful action or navigation.