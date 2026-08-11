# 2026-08-11 Pi-tools refactor pass

## Directive
Run a behavior-preserving refactor pass over the files currently in flight by recent work, in preparation for T-823, T-820, T-821, T-802, T-797.

## Scope
Files to refactor:
- `extensions/pi-coas/scheduler.ts` + `scheduler-run-once.ts`
- `extensions/pi-panopticon/ui/agent-overlay.ts` + `agent-list.ts` + `agent-detail.ts` + `summary-projection.ts` + `agent-summary-render.ts`
- `extensions/pi-kanban/complete-tool.ts` + `board-tools.ts` + `board.ts` + `index.ts`
- `extensions/pi-goal/goal-extension.ts` + `goal-tools.ts` + `goal-persist.ts` + `goal-plan.ts` + `goal-render.ts` + `goal-types.ts`

Off-limits: any file on mid-edit T-834/T-837 worktrees (none currently in local worktree list), other active branches, and `working-notes`.

## Skill used
No dedicated `refactor` skill exists in the repo or `coas/skills/`. Using `skills/pi-extension-dev/SKILL.md` (small helpers, narrow handlers, clear boundaries) plus project rules: AGENTS.md, Google TS style, architecture fitness, no new dependencies.

## Goals
- Reduce duplication and oversized functions.
- Extract small pure helpers without changing behavior.
- Improve type imports and naming consistency.
- Keep all existing tests passing.
- No new tests required.

## Gates
- [ ] `npm run check` clean.
- [ ] `npm test` 148 passed / 1 skipped (T-823 placeholder unchanged).
- [ ] Architecture tests green.
- [ ] Before/after line counts recorded.
- [ ] Push before reporting DONE.

## Plan
1. **pi-coas**: Extract scheduler catchup/queue helpers, simplify run-once result types, remove unused `spawnedRuns` from `RunOnceResult`.
2. **pi-panopticon/ui**: Consolidate border rendering, simplify summary section, remove dead/duplicated helpers.
3. **pi-kanban**: Extract common log event formatting, deduplicate validation in `complete-tool.ts`, simplify `board-tools.ts` wrapper functions.
4. **pi-goal**: Split `goal-extension.ts` command handler into smaller per-action handlers, extract milestone parsing, reduce inline repetition.
5. Run targeted tests after each module, then full suite + checks.
6. Commit and push as `refactor: cleanup in-flight modules`.
