# Kanban UX Improvements — Compliance Findings & Plan

## Executive Summary

Audit of the kanban extension (`extensions/kanban/`) against the pi-extension-dev and tui-design skill guidelines, the README spec, and the AGENTS.md quality gates. Findings are ranked by user-visible impact.

---

## Compliance Findings

### F-01: Tool description says `kanban_edit` metadata only editable on backlog/todo — but tools reference doc contradicts

**Severity:** Medium  
**Location:** `task-tools.ts` → `kanban_edit` description  
**Finding:** The tool description says "Metadata (title/etc) can only be edited on backlog or todo tasks." but the `performEdit` function also correctly throws for in-progress/blocked/done tasks. However, the README.md table says "Edits backlog/todo task metadata, or appends a progress note to any task" which implies the constraint is intentional. The issue is that the error message says "Can only edit metadata… for tasks in backlog or todo" but the `done` column is also excluded despite not being mentioned. This is a minor clarity gap, not a bug.

**Fix:** Update the error message to explicitly list all columns where metadata edits are allowed (`backlog`, `todo`) and clarify that `notes` are always allowed.

---

### F-02: `kanban_create` ignores empty-string tags/description — treats `""` same as omitted

**Severity:** Low  
**Location:** `task-tools.ts` → `kanban_create`  
**Finding:** When `tags` or `description` are passed as explicit empty strings (the schema default), the `descPart` conditional `description ? … : ""` treats `""` as falsy, so no field is written to the log line. This is actually correct behavior — empty strings should not produce log noise. No fix needed.

**Status:** No action required (working as intended).

---

### F-03: `generateSnapshotSummary` shows `doneLast` but omits done count when all done tasks are recent

**Severity:** Low  
**Location:** `snapshot.ts` → `generateSnapshotSummary`  
**Finding:** When there are ≤5 done tasks, the label reads "last 5 of 5" instead of just "5". This is misleading — "last 5 of 5" implies there might be more. The full snapshot has the same issue ("last 10 of 10").

**Fix:** Change label to show count when all items are visible, only use "last N of M" when M > N.

---

### F-04: Overlay move-picker accessible from non-movable columns

**Severity:** Medium  
**Location:** `overlay.ts` → `handleBoardInput`, `overlay-render.ts` → `renderMovePicker`  
**Finding:** Pressing `m` enters the move-picker from any column, but `moveTask` only works for backlog/todo tasks. The overlay should (1) guard entry in the controller and (2) show a brief status message explaining why the action is unavailable.

**Fix:** 
1. Guard `handleBoardInput`: only enter move-picker when `task.col === "backlog" || task.col === "todo"`
2. Set a status message like "Move unavailable: task is in-progress" for non-movable columns
3. This matches the backend guard in `moveTask`

---

### F-05: Overlay delete accessible from non-deletable columns

**Severity:** Medium  
**Location:** `overlay.ts` → `handleBoardInput`  
**Finding:** Pressing `d` on any task enters the confirm-delete screen, but `deleteTask` throws for in-progress and blocked tasks. The overlay should (1) guard entry in the controller and (2) show a brief status message explaining the restriction.

**Fix:** 
1. Guard `handleBoardInput`: only enter confirm-delete when `task.col !== "in-progress" && task.col !== "blocked"`
2. Set a status message like "Delete unavailable: complete or unblock the task first"

---

### F-06: Widget doesn't show blocked task reasons or agents

**Severity:** Low  
**Location:** `watcher.ts` → `buildWidgetLines`  
**Finding:** The widget shows in-progress tasks with agent names, but the counts for other columns don't give any detail. Blocked tasks especially benefit from seeing the reason at a glance — this is the most actionable information for an orchestrator.

**Fix:** Add the most recent blocked task's reason to the widget line, truncated to 30 chars: `blocked 1 (waiting on API key)`. If no blocked tasks, show just `blocked 0`.

---

### F-07: TUI overlay doesn't handle empty board gracefully

**Severity:** Low  
**Location:** `overlay-render.ts` → `renderBoard`  
**Finding:** When the board has zero tasks, the overlay still shows 5 column headers and 8 empty rows. This is fine but the hints text could be more helpful — suggesting how to create a task.

**Fix:** When board has zero tasks, show a helpful empty-state message instead of empty columns.

---

### F-08: `kanban_snapshot` always logs a SNAPSHOT event, even on repeated calls

**Severity:** Low  
**Location:** `board-tools.ts` → `kanban_snapshot` execute  
**Finding:** Every snapshot call appends a `SNAPSHOT T-SYS` line to board.log. This pollutes the log without functional value — it's just an audit trail for snapshot generation. Combined with auto-compaction, this is mostly harmless but it's log noise.

**Fix:** Keep the SNAPSHOT event for auditability — this is intentional per the README. No fix needed.

**Status:** No action required (intentional audit trail).

---

### F-09: Compact summary doesn't indicate blocked reasons

**Severity:** Medium  
**Location:** `snapshot.ts` → `renderSummaryColumn`  
**Finding:** The compact summary for blocked tasks just shows `T-NNN: title — agent`. Blocked tasks are the most actionable items — the reason is essential context. Without it, the orchestrator must do an extra `kanban_snapshot task_id=T-NNN` call for every blocked task.

**Fix:** Include the reason in compact summary for blocked tasks: `T-NNN: title — agent (reason)`.

---

### F-10: `kanban_claim` auto-pick only considers `todo` tasks — skips newly created tasks in `backlog`

**Severity:** Low  
**Location:** `claim-tools.ts` → `performClaim`  
**Finding:** The auto-pick path checks `t.col !== "todo"`, meaning freshly created tasks in backlog are never auto-picked. This is by design — the workflow is create → move to todo → claim. The README documents this. No fix needed.

**Status:** No action required (by design).

---

## Action Plan (8-Step Workflow)

### Step 1: Compliance findings document ✅ (this document)

### Step 2: Navigator review of findings
- Run `team_run consult` with the findings for review
- Address any feedback

### Step 3: Code fixes
Implement the actionable findings:

| Finding | Action | Files |
|---------|--------|-------|
| F-01 | Improve error message clarity | `task-tools.ts` |
| F-03 | Fix done-count label when all items visible | `snapshot.ts` |
| F-04 | Guard move-picker + status message for non-movable columns | `overlay.ts` |
| F-05 | Guard delete + status message for non-deletable columns | `overlay.ts` |
| F-06 | Show blocked reason in widget | `watcher.ts` |
| F-07 | Empty-board state in overlay | `overlay-render.ts` |
| F-09 | Show blocked reason in compact summary | `snapshot.ts` |

### Step 4: Navigator review of fixes
- Run `team_run consult` with the diff
- Address any feedback

### Step 5: Refactor if needed
- Consolidate any duplicated guard logic
- Ensure error messages are consistent between tool layer and overlay

### Step 6: Run full validation
```bash
npm run check   # typecheck → lint → knip → type-coverage
npm test        # vitest
```

### Step 7: Commit to branch
```bash
git add -A
git commit -m "feat(kanban): UX improvements — overlay guards, blocked visibility, snapshot clarity"
```

### Step 8: ADR and progress log update
- Create ADR for the guard-pattern in overlay
- Update this document with completion notes

---

## Progress Log

- **2026-05-04** Step 1 complete: Compliance findings documented
- **2026-05-04** Step 2 complete: Navigator review — expanded F-04/F-05 to include status messages, F-06 to include truncation
- **2026-05-04** Steps 3–6 complete: Code fixes implemented, all tests pass (395/395), all quality gates pass
- **2026-05-04** Step 7 complete: Committed to feature/kanban-ux (4e27fbd)
- **2026-05-04** Step 8 complete: ADR and progress log updated