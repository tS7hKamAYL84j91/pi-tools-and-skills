# pi-goal Extension

Bounded project-goal workflow tools and the `/goal` command for pi.

## Stable Tools/Commands

### Commands

- `/goal` or `/goal help` — show available commands.
- `/goal <text>` — create a project goal from text and start a bounded **manual** run.
- `/goal <text> --continuous` or `--until-complete` — explicitly opt into continuous mode; it may continue across passing non-final milestones but never calls `goal_complete` automatically.
- `/goal file <path> [goal start|--continuous|--until-complete]` — use an existing project file as the goal source; explicit continuous mode creates `.pi/goal/instances/<goalId>/TODO.md` and starts a 20-turn run.
- `/goal status` — show the current goal state.
- `/goal plan [milestone title]` — generate a reviewable `SPEC.md`/`PLAN.md`/`STATUS.md` under `.pi/goal/instances/<goalId>/` and pause for approval.
- `/goal approve` — accept the generated plan and allow implementation.
- `/goal run [--turns N|--until-complete]` — continue an active or paused goal; plain `/goal run` defaults to a bounded 20-turn continuous run. If a plan is required but not yet approved, `/goal run` implicitly approves it.
- `/goal pause`, `/goal resume`, `/goal stop`, `/goal steer <text>`, `/goal clear`, `/goal edit <text>` — manage goal lifecycle. Steer is current-run, untrusted guidance and never changes the objective or approved plan. Resume starts a real bounded run; stop/pause/error/gate/budget/hard-timeout halt continuation. `/goal clear` removes the bound `.pi/goal/instances/<goalId>/` state and run artifacts for the current workspace. `/goal edit` updates the objective and invalidates existing evidence/plan revisions.

### Tools

- `goal_get` — read the current project-local goal state.
- `goal_plan` — generate or replace the reviewable plan with ordered milestones and validation commands.
- `goal_verify` — record structured verification evidence (`exitCode`, `outputSummary`) for the current milestone.
- `goal_complete` — mark the current milestone or goal complete with concrete audit evidence. When a plan is active, the current milestone must have a passing `goal_verify` record correlated to the current `goalId`, `runId`, and `milestoneRevision`; otherwise it fails closed. Root-owned completion is never automatic.

### Operator-configured completion gate

An operator may set `PI_GOAL_GATE_COMMAND` before starting pi. When configured, `goal_complete` runs that command in the active workspace and blocks completion on failure with bounded diagnostics. With no configured gate, completion behavior is unchanged. Liveness thresholds are operator-only: `PI_GOAL_LIVENESS_SOFT_MS` and `PI_GOAL_LIVENESS_HARD_MS`, each clamped to 1 second–24 hours; defaults are 5 and 15 minutes.

The public `goal_complete` schema retains deprecated `gate_command` only as ignored compatibility input. Its value is never executed and cannot select or override the command; the environment is the trusted operator configuration boundary. Structured `goal_verify` evidence remains separate and supported.

## Ownership and recovery (ADR-059)

`/goal continue` is an alias for `/goal resume`; ordinary multi-word objectives remain supported. Only the explicitly claimed command loop drives turns. `agent_end` settles its matching waiter and cannot launch a second loop. Runs wait for the host to settle before another send or replacement.

Each claim has an opaque token, monotonic generation, and revision-checked state. A competing process cannot acquire it even after the original process exits. To recover, inspect any uncertain old work, use an authorized bound session's `/goal stop` or `/goal pause`, then explicitly `/goal run` or `/goal resume`. There is no age/TTL/PID takeover, automatic replay, or claim of remote quiescence. Malformed ownership fails closed and needs operator repair; do not delete it merely to force a retry.

Replacement reserves the current attempt before switching, installs the lineage binding in `setup`, validates the fresh callback session, then atomically consumes the reservation with admission. Stop/edit/plan/completion/timeout revoke before local waiter settlement. One local driver is allowed per Pi process. A persisted token alone never grants an observing watchdog permission to act.

A void SDK send records an admitted attempt, not acknowledged delivery. An awaited replacement-send rejection can also have an uncertain outcome. Pause and inspect rather than blindly replaying. Filesystem checks reject detected symlinks/nonregular authority; they cannot eliminate every hostile-directory check/use race.

`/goal clear` deletes authoritative state, known projections, and recognized generated run files only. Unknown files and nonempty directories are preserved. Projection/cleanup failure after authority commit is reported separately, never as rollback.

## Provisional Surfaces

- `.pi/goal/instances/<goalId>/TODO.md` extraction logic.
- Bounded turn iteration limits.

## Cross-Extension Dependencies

- Independent, but often invoked in sequence with `pi-teams` for review.

## Runtime files

The extension writes project-local state under `.pi/goal/instances/<goalId>/` and adds that directory to `.git/info/exclude` when possible. Durable goal artifacts include:

- `goal.json` — authoritative state in the bound goal instance (schema v3 for new runs; v1/v2 are read and migrated to manual mode).
- `GOAL.md` — human-readable summary.
- `TODO.md` — initial task tracker created from text/file goals.
- `SPEC.md` — goals, non-goals, constraints, and done-when checks.
- `PLAN.md` — ordered milestones with validation commands and a decision-notes section.
- `STATUS.md` — live audit log with normalized execution state, milestone checklist, last verification, turns used, bounded lifecycle events, and blockers.
- `runs/YYYY/MM/DD/*.{jsonl,md}` — per-iteration transcripts.

Markdown files are derived from `goal.json`; `goal.json` is committed first, and `loadGoal` deterministically rewrites every bound-instance projection so an interrupted save cannot leave stale derived guidance.

## Enablement

`pi-goal` is enabled globally by this repository's `make setup` package installation. A workspace may still override extension loading in its `.pi/settings.json`.

## What this does NOT do

- Does not replace project task boards or kanban systems.
- Does not mark goals complete automatically; the root agent must call `goal_complete` with concrete evidence.
- Does not bypass normal pi session boundaries; bounded runs use fresh sessions and graceful stop points.
- Does not run a scheduler: liveness recovery is one session-scoped, unref'd in-process watchdog that warns once, nudges at most once while idle per epoch, and is cleaned up on shutdown.
- Does not execute model-supplied validation commands; `goal_verify` records structured evidence, while only the trusted operator-configured `PI_GOAL_GATE_COMMAND` completion gate is executed.
