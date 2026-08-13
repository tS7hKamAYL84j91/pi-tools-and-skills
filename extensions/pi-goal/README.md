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

### Operator-configured completion gate

An operator may set `PI_GOAL_GATE_COMMAND` before starting pi. When configured, `goal_complete` runs that command in the active workspace and blocks completion on failure with bounded diagnostics. With no configured gate, completion behavior is unchanged.

The public `goal_complete` schema retains deprecated `gate_command` only as ignored compatibility input. Its value is never executed and cannot select or override the command; the environment is the trusted operator configuration boundary. Structured `goal_verify` evidence remains separate and supported.

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

Markdown files are derived from `goal.json`; `goal.json` is committed first, and `loadGoal` deterministically rewrites every projection so an interrupted save cannot leave stale derived guidance.

## Enablement

`pi-goal` is enabled globally by this repository's `make setup` package installation. A workspace may still override extension loading in its `.pi/settings.json`.

## What this does NOT do

- Does not replace project task boards or kanban systems.
- Does not mark goals complete automatically; the root agent must call `goal_complete` with concrete evidence.
- Does not bypass normal pi session boundaries; bounded runs use fresh sessions and graceful stop points.
- Does not execute model-supplied validation commands; `goal_verify` records structured evidence, while only the trusted operator-configured `PI_GOAL_GATE_COMMAND` completion gate is executed.
