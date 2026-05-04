# CoAS UX Improvements

## Overview

Targeted UX improvements for the `pi-coas` extension, focusing on error
handling, tool descriptions, and code quality.

## 8-Step Workflow

1. **Audit & Compliance Findings** — Document all findings in this file
2. **Navigator Review: Findings** — `team_run consult` to review findings
3. **Code Fixes** — Implement the approved fixes
4. **Navigator Review: Fixes** — `team_run consult` to review code changes
5. **Refactor** — Clean up any structural issues found during fixes
6. **Navigator Review: Refactor** — `team_run consult` to review refactor
7. **Commit** — Commit all changes to the `feature/coas-ux` branch
8. **ADR & Progress Log** — Update architecture records and log progress

---

## Step 1: Audit & Compliance Findings

### F1: Tool descriptions missing usage hints

Several tool descriptions are too terse. Agents benefit from brief usage hints
that disambiguate similar tools and clarify when to use each.

**Affected tools:**
- `coas_workspace_read` — doesn't mention it auto-selects the current workspace when no selector is given
- `coas_workspace_update` — doesn't warn that empty text is rejected
- `coas_schedule_run` — doesn't make clear that non-dry-run is *always* disabled, not just defaulted

**Fix:** Add concise usage hints to `description` fields.

### F2: Inconsistent error handling in tools

Some tools throw raw `Error` for user-facing validation failures (e.g. "No
workspace selected", "Schedule add requires room, name, cron, and prompt").
These appear as internal errors rather than actionable tool output.

**Affected files:**
- `workspaces.ts` — `resolveWorkspacePath` throws on missing selector/cwd
- `schedules.ts` — `addSchedule` throws on missing fields; `readSchedule` throws on unknown task

**Fix:** Return `fail()` tool results for user-correctable errors instead of
throwing. This makes the error visible to the agent as actionable feedback.

### F3: `commandSummary` discards useful exit-code context for widget display

`commandSummary` formats exit code at the top but `widgetLines` may truncate it
when the output is long. The status bar widget would benefit from a short-form
fallback.

**Fix:** Add `shortCommandSummary` for widget use that shows only the exit
code line + first N significant lines.

### F4: `format.ts` — `truncateText` mutates state via side-effect

The `truncated` flag is recomputed inside the loop but the original
`TruncatedText` interface separates concerns cleanly. However the function
sets `truncated = true` in multiple paths and doesn't communicate *which*
limit was hit (bytes vs lines).

**Fix:** Add `limitHit` field to `TruncatedText` for diagnostic clarity.

### F5: Lifecycle `contextInstruction` checks for `.coas/workspace.env` but misses `COAS_HOME`-relative workspaces

A project cwd may not contain `.coas/workspace.env` but the cwd path might
still be inside `COAS_HOME/workspaces/<id>`. The current check only looks for
cwd-relative `.coas/workspace.env`, missing the `pathInside` + `COAS_HOME`
case that `currentWorkspaceLabel` *does* detect via `COAS_WORKSPACE_ID` env.

**Fix:** Use `currentWorkspaceLabel` result as the primary gate, which already
handles both cases. Remove the redundant `.coas/workspace.env` file check.

### F6: `schedules.ts` `parseSchedule` swallows malformed schedule entries silently

When `parseEnv` returns partial data (missing `TASK_ID`, `CRON_EXPR`, etc.),
`parseSchedule` fills in defaults (`taskId = basename`, `cronExpr = ""`) and
still calls `validateCronExpr` which throws — but the error message loses the
file path context.

**Fix:** Include the env file path in validation error messages so the user can
locate the bad schedule.

### F7: No test coverage for core workspace and schedule logic

Only `format.ts` has tests. `workspaces.ts`, `schedules.ts`, `status.ts`, and
`store.ts` have zero test coverage.

**Fix:** Add focused unit tests for `store.ts` (slugify, assertSafeId,
pathInside, parseEnv, formatEnv) and `schedules.ts` (validateCronExpr,
formatScheduleList) as these are pure functions with clear contracts.

---

## Step 2: Navigator Review — Findings

> Completed via `team_run consult`. All findings (F1–F7) approved for implementation. Navigator confirmed:
> - F1 (tool descriptions): Clear improvement, helps disambiguate similar tools.
> - F2 (fail() instead of throw): Standard pi tool pattern, user-correctable errors should not raise.
> - F3 (shortCommandSummary): Useful for widget display; proportionate addition.
> - F4 (limitHit): Low-cost diagnostic addition, no risk.
> - F5 (lifecycle context instruction): Removing redundant file check simplifies logic.
> - F6 (schedule parse errors): Including file path is a standard UX fix.
> - F7 (unit tests): Proportionate; testing pure functions first is correct.

---

## Step 3: Code Fixes

**Completed.** Changes implemented:

- **F1**: Updated tool descriptions for `coas_workspace_read`, `coas_workspace_update`, `coas_schedule_run` with usage hints.
- **F2**: Wrapped `coas_workspace_read`, `coas_workspace_update`, `coas_schedule_add`, `coas_schedule_run`, `coas_schedule_remove` tool handlers in try/catch returning `fail()` for user-correctable errors.
- **F3**: Added `shortCommandSummary()` to `format.ts` for concise widget display.
- **F4**: Added `limitHit` field to `TruncatedText` type and `truncateText()` function.
- **F5**: Simplified `contextInstruction()` in `lifecycle.ts` — removed redundant `.coas/workspace.env` file check, using `currentWorkspaceLabel` + `pathInside` as primary gate. Removed unused `join` import.
- **F6**: Wrapped `validateCronExpr` call in `parseSchedule` with file-path context in error message.
- **F7**: Added `tests/pi-coas-unit.test.ts` with tests for `store` (slugify, workspaceIdFromRoom, assertSafeId, pathInside, parseEnv/formatEnv), `format` (shortCommandSummary, truncateText limitHit), and `schedules` (validateCronExpr, formatScheduleList).

All 403 tests pass. Typecheck, lint, knip clean. Type coverage 99.09%.

---

## Step 4: Navigator Review — Fixes

> Completed. Navigator reviews verified:
> - All tool throw paths now wrapped in try/catch + fail() (even coas_status, coas_doctor, list tools)
> - F5 lifecycle simplification is safe — comment added explaining why .coas/workspace.env check was redundant
> - shortCommandSummary handles all edge cases (empty, stderr-only)
> - Test coverage expanded with fail() result path tests

---

## Step 5: Refactor

**No structural refactoring needed.** The try/catch + fail() pattern in tools.ts is consistent and appropriate. Each handler customizes `details` differently, so extracting a wrapper would add indirection without meaningful benefit. The AGENTS.md "No Over-Engineering" directive applies.

Minor cleanliness pass already done:
- Removed unused `join` import from lifecycle.ts
- Exported `truncateText` from format.ts for test visibility
- Added comment explaining F5 simplification in lifecycle.ts

---

## Step 6: Navigator Review — Refactor

> Completed. Navigator challenged the no-refactor decision. After comparison, all 10 catch blocks share the same `(error as Error).message` pattern but each provides different `details` context. A `toolFail` helper would save 1-2 lines per handler but add a whole function. Per AGENTS.md: no over-engineering. Decision stands.

---

## Step 7: Commit

> To be completed after all reviews.

---

## Step 8: ADR & Progress Log

> To be completed after commit.