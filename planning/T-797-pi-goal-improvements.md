# T-797 — pi-goal durable memory + plan mode + stop-and-fix gate

## Goal
Harden `extensions/pi-goal/` so long-horizon goals carry a durable spec/plan/status record, require an explicit planning phase before implementation, and enforce per-milestone validation before `goal_complete`.

## In scope
- `.pi/goal/` durable artifacts:
  - `SPEC.md` — goals, non-goals, constraints, done-when.
  - `PLAN.md` — ordered milestones, per-milestone validation command, decision-notes section.
  - `STATUS.md` — live audit: current milestone, last verification, blockers, last-turn outcome.
- `GoalState` schema extension: `milestones`, `currentMilestoneIndex`, `lastVerification`, `planRequired`, `planApproved`. Atomic writes after each iteration.
- Schema versioning: read stored `schemaVersion` (accept `1` or `2`), synthesize defaults for legacy v1 loads, write `2` only after `/goal plan`.
- `/goal plan` command — generates/updates SPEC+PLAN+STATUS, sets `planRequired=true`, `planApproved=false`, pauses run.
- `/goal run` — refuses implementation if `planRequired && !planApproved`; if a plan exists and is unapproved, running it implicitly approves the plan (user action = acceptance). Optional explicit `/goal approve` also provided.
- `/goal edit <text>` — updates objective, resets `planApproved=false` and `currentMilestoneIndex=0`, requiring re-planning.
- `goal_verify` tool — records structured `{ milestoneIndex, command, exitCode, outputSummary, timestamp }` evidence in `goal.json`.
- `goal_complete` hard gate — for `planRequired` goals, the current milestone must have a matching `lastVerification` with `exitCode === 0`; otherwise throw. On success, mark milestone done, advance, and complete the goal only when all milestones are done.
- Backward compatibility — legacy goals without `milestones`/`planRequired` continue to work with the old evidence-only gate.
- Tests — schema migration, plan-mode flow, hard-block on missing/failed evidence, progression after repaired evidence.

## Out of scope
- Arbitrary shell command execution by pi-goal. Validation is an auditable structured-evidence gate, not proof-of-execution. A malicious agent could fabricate evidence, but the structured, persisted record raises the bypass bar and creates an audit trail.
- New ADR (brief explicitly waives it).
- Changes outside `extensions/pi-goal/` and its tests, except shared `lib/file-persistence.js` already used by state.ts.

## Files to change
- `extensions/pi-goal/state.ts` — schema, persistence, atomic writes, rendering, derived-file regeneration.
- `extensions/pi-goal/goal-extension.ts` — `/goal plan`, `/goal approve`, `/goal edit`, `runGoalLoop` gate, `goal_verify`, `goal_complete` gate.
- `extensions/pi-goal/prompts.ts` — inject plan/milestone/verification context into prompts.
- `extensions/pi-goal/README.md` — document new files, commands, and gate.
- `tests/goal/pi-goal-tools.test.ts` — extend existing tests.
- `tests/goal/pi-goal-plan-verify.test.ts` — new regression tests for plan mode and hard gate.

## Implementation notes
- **Write order:** `saveGoal` writes `SPEC.md`, `PLAN.md`, `STATUS.md` first, then `goal.json` last. `loadGoal` calls `regenerateDerivedFiles(cwd, state)` to repair any missing/stale markdown.
- **Plan approval:** Implicit via `/goal run`; explicit via `/goal approve`.
- **Re-planning:** Re-running `/goal plan` on an active planned goal preserves existing milestone titles/validation commands when possible, but resets `planApproved=false` and `currentMilestoneIndex=0` to force review.

## Acceptance gates
1. `npm run check` clean.
2. Existing tests pass.
3. New tests cover: legacy v1 goal loads with defaults; legacy goal still completes with evidence; planned goal blocked when verification missing; planned goal blocked when `exitCode !== 0`; planned goal advances after valid verification; `/goal edit` invalidates plan and resets milestone index.
4. Manual demo: create goal → `/goal plan` → inspect PLAN.md → `goal_verify` → `goal_complete` → STATUS.md updated.

## Review status
- Navigator: council review required (material state change).
- Council: APPROVED_WITH_CHANGES. Required changes (schema versioning, structured `goal_verify`, derived-file write ordering, `KNOWN_ACTIONS` dispatch, `/goal edit` invalidation) are reflected above.