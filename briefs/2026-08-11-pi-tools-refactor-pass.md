# 2026-08-11 Pi-tools refactor pass

## Directive
Run a behavior-preserving refactor pass over the files currently in flight by recent work, in preparation for T-823, T-820, T-821, T-802, T-797.

## Scope
Files refactored:
- `extensions/pi-coas/scheduler.ts`
- `extensions/pi-panopticon/ui/agent-overlay.ts` + `agent-list.ts` + `agent-detail.ts` + `ui-format.ts`
- `extensions/pi-kanban/complete-tool.ts` + `board-tools.ts`
- `extensions/pi-goal/goal-extension.ts` + `goal-tools.ts` + new `goal-helpers.ts`

Off-limits: T-834/T-837 worktrees (none present), other active branches, and `working-notes`.

## Skill used
No dedicated `refactor` skill exists in the repo or in `coas/skills/`. Used `skills/pi-extension-dev/SKILL.md` (small helpers, narrow handlers, clear boundaries) plus project rules: AGENTS.md, Google TS style, architecture fitness, no new dependencies.

## Changes made
- **pi-goal**: Created `extensions/pi-goal/goal-helpers.ts` (command parsing, `requireGoal`, plan-review prompt, help text, stopped message). Split `/goal` command handler into 12 per-action nested handlers plus a dispatch table in `goal-extension.ts`. Deduplicated `requireGoal` with `goal-tools.ts`.
- **pi-coas**: Extracted `loadEnabledSchedules`, `updateCounts`, `resetCounts` in `scheduler.ts` to remove duplicated schedule-state bookkeeping.
- **pi-kanban**: Extracted `validateTaskComplete` and `completeLogLine` helpers in `complete-tool.ts`. Extracted `selectSnapshotView` and `formatCompactNote` in `board-tools.ts`.
- **pi-panopticon/ui**: Added shared `accentBorder` helper in `ui-format.ts` and used it in `agent-list.ts` and `agent-detail.ts`.

## Before/after line counts (rough)
| File | Before | After | Notes |
|------|--------|-------|-------|
| pi-goal/goal-extension.ts | 563 | 484 | Extracted helpers + handlers |
| pi-goal/goal-helpers.ts | — | 136 | New shared helper module |
| pi-goal/goal-tools.ts | 256 | 247 | Removed duplicate `requireGoal` |
| pi-coas/scheduler.ts | 261 | 267 | Slightly larger due to helper extraction |
| pi-kanban/complete-tool.ts | 122 | 150 | Helper extraction |
| pi-kanban/board-tools.ts | 262 | 269 | Helper extraction |
| pi-panopticon/ui/ui-format.ts | 64 | 88 | Added `accentBorder` helper |
| pi-panopticon/ui/agent-list.ts | 235 | 234 | Uses shared helper |
| pi-panopticon/ui/agent-detail.ts | 219 | 218 | Uses shared helper |

## Validation
- `npm run check` — clean (typecheck, lint, knip, type-coverage 99.16%).
- `npm test` — 148 passed, 1 skipped (T-823 placeholder unchanged).
- Architecture tests — 46/46 passed, including file-size and function-parameter budgets.

## Note
One pre-existing flaky test (`tests/coas/pi-coas-scheduler-continuation.test.ts`) occasionally fails in full-suite runs with `ENOTEMPTY` during temp-directory cleanup, but passes on isolated re-run. It is unrelated to this refactor.

## Push
Committed as `18f2a2c` and pushed to `origin/main`.
