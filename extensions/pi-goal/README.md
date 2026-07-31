# pi-goal Extension

Bounded project-goal workflow tools and the `/goal` command for pi.

## Stable Tools/Commands

### Commands

- `/goal` or `/goal help` — show available commands.
- `/goal <text>` — create a project goal from text and start a bounded run.
- `/goal file <path> [goal start|--until-complete]` — use an existing project file as the goal source; with `goal start`/`--until-complete`, create `.pi/goal/TODO.md` from the file and start a 20-turn run.
- `/goal status` — show the current goal state.
- `/goal plan [milestone title]` — generate a reviewable `SPEC.md`/`PLAN.md`/`STATUS.md` under `.pi/goal/` and pause for approval.
- `/goal approve` — accept the generated plan and allow implementation.
- `/goal run [--turns N|--until-complete]` — continue an active or paused goal. If a plan is required but not yet approved, `/goal run` implicitly approves it.
- `/goal pause`, `/goal resume`, `/goal stop`, `/goal clear`, `/goal edit <text>` — manage goal lifecycle. `/goal stop` immediately marks the bounded run idle and unblocks the goal loop so no further automatic turns are scheduled. `/goal clear` removes `.pi/goal/` local state and run artifacts for the current workspace. `/goal edit` updates the objective of an active or paused goal and invalidates any existing plan.

### Tools

- `goal_get` — read the current project-local goal state.
- `goal_plan` — generate or replace the reviewable plan with ordered milestones and validation commands.
- `goal_verify` — record structured verification evidence (`exitCode`, `outputSummary`) for the current milestone.
- `goal_complete` — mark the current milestone or goal complete with concrete audit evidence. When a plan is active, the current milestone must have a passing `goal_verify` record before `goal_complete` succeeds; otherwise it hard-blocks and reports what is missing.

## Provisional Surfaces

- `.pi/goal/TODO.md` extraction logic.
- Bounded turn iteration limits.

## Cross-Extension Dependencies

- Independent, but often invoked in sequence with `pi-teams` for review.

## Runtime files

The extension writes project-local state under `.pi/goal/` and adds that directory to `.git/info/exclude` when possible. Durable goal artifacts include:

- `goal.json` — authoritative state (schema v2 when a plan is active, v1 for legacy goals).
- `GOAL.md` — human-readable summary.
- `TODO.md` — initial task tracker created from text/file goals.
- `SPEC.md` — goals, non-goals, constraints, and done-when checks.
- `PLAN.md` — ordered milestones with validation commands and a decision-notes section.
- `STATUS.md` — live audit log with current milestone, last verification, turns used, and blockers.
- `runs/YYYY/MM/DD/*.{jsonl,md}` — per-iteration transcripts.

Markdown files are derived from `goal.json`; `goal.json` is written last so a crash leaves the authoritative state intact and `loadGoal` can regenerate missing derived files.

## Enablement

`pi-goal` is a project/runtime extension. Enable it per workspace by adding the package extension path to that workspace's `.pi/settings.json`; it is intentionally not enabled globally by `make setup`.

## What this does NOT do

- Does not replace project task boards or kanban systems.
- Does not mark goals complete automatically; the root agent must call `goal_complete` with concrete evidence.
- Does not bypass normal pi session boundaries; bounded runs use fresh sessions and graceful stop points.
- Does not execute validation commands itself; `goal_verify` records structured evidence, making the gate auditable but not cryptographically proof-of-execution.
