# pi-goal Extension

Project-goal execution that starts immediately and continues until the root agent records completion.

## Commands

- `/goal <text>` — create a goal and immediately run it until completion.
- `/goal file <path>` — use the original source file directly and immediately run the goal until completion.
- `/goal status` — show the current goal.
- `/goal run` or `/goal resume` — resume direct unbounded execution.
- `/goal run --turns N` — explicitly request a bounded 1–20 turn run.
- `/goal pause`, `/goal stop`, `/goal steer <text>`, `/goal edit <text>`, `/goal clear` — lifecycle controls.

Plain goal creation and resume use `turnBudget: 0` as the persisted unbounded sentinel. Runs continue across fresh sessions until `goal_complete`, an explicit pause/stop, a genuine runtime failure, or the operator-configured completion gate stops them. There is no plan generation, milestone verification, or approval gate.

## Tools

- `goal_get` — read the active project-local goal state.
- `goal_complete` — request completion with evidence; only the operator-configured trusted verifier may mark it complete.
- `goal_block` — pause a genuinely blocked goal with a concrete reason and checkable resume condition.

The root agent owns `goal_complete`. Spawned workers report DONE/BLOCKED to the root and cannot complete the goal themselves.

## Completion gate

`PI_GOAL_GATE_COMMAND` is required before `goal_complete` can complete a goal. The command is operator-owned, runs in the workspace, and its bounded, secret-redacted result is persisted as a completion check. Agent evidence is retained but never substitutes for the check. The deprecated model-supplied `gate_command` parameter is ignored.

A normal verifier exit `1` is a validation rejection. By default it pauses the run. Operators may set `PI_GOAL_REPAIR_ATTEMPTS` to `1` or `2` to permit that many in-scope repair-and-recheck attempts; the default is `0`. The durable budget survives session replacement. Cancellation, timeouts, policy changes, command-not-found/permission errors, other exit codes, and exhausted attempts pause safely and require explicit review/resume. `PI_GOAL_GATE_TIMEOUT_MS` bounds each check (default 15 minutes; range 1 second–24 hours).

Liveness thresholds remain operator-only: `PI_GOAL_LIVENESS_SOFT_MS` and `PI_GOAL_LIVENESS_HARD_MS`, clamped to 1 second–24 hours (defaults: 5 and 15 minutes). After the soft threshold, the watchdog may inject one continuation only while the host is demonstrably idle with nothing queued. It never nudges or stops a live turn. At the hard threshold, a still-idle run produces one diagnostic requesting manual inspection; elapsed wall time alone never marks productive work failed. Explicit stop/pause, uncertain delivery, runtime/persistence failure, and ownership loss retain their containment behavior.

## Ownership and recovery

Only the explicitly claimed command loop drives turns. Claims use an opaque token, monotonic generation, and revision-checked state. Competing processes cannot acquire an existing claim. `agent_end` settles only its matching waiter and never starts a second driver.

Replacement sessions reserve the next attempt before switching, bind the new session to the goal, validate workspace/session lineage, and atomically consume the reservation. Uncertain delivery, replacement failure, or persistence failure pauses safely rather than replaying work blindly.

Use `/goal stop` or `/goal pause` to contain uncertain work, inspect it, then `/goal run` to resume. `/goal clear` removes recognized generated state/run files only and preserves unknown content.

## Runtime files

State lives under `.pi/goal/instances/<goalId>/`:

- `goal.json` — authoritative schema-v3 state.
- `GOAL.md` — the single active human-readable summary, including bounded reported activity and changed files.
- `runs/YYYY/MM/DD/*.{jsonl,md}` — per-invocation records.

Text goals store the objective in `goal.json`; file goals retain their original source path without copying or rewriting the source. New goals do not generate TODO, SPEC, PLAN, or STATUS scaffolding. Existing documents and run history are left intact on load/resume. `/goal plan` and `/goal approve` are no longer commands; plain non-command text is treated as a new objective.

Legacy v1/v2 and planned v3 states remain readable. Starting/resuming them removes obsolete plan, milestone, approval, and verification state before direct execution.

## What this does NOT do

- Does not require or generate a plan.
- Does not request approval before implementation.
- Does not infer completion or trust completion prose; the root agent requests completion and the operator verifier decides it.
- Does not treat a blocker as success; `goal_block` pauses until explicit resume.
- Does not bypass explicit stop/pause, ownership, persistence, session-lineage, liveness, or trusted completion-gate safety boundaries.
- Does not replace Kanban or other project work tracking.
