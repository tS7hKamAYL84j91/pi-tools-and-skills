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
- `goal_complete` — complete the goal with concrete audit/validation evidence.

The root agent owns `goal_complete`. Spawned workers report DONE/BLOCKED to the root and cannot complete the goal themselves.

## Completion gate

An operator may set `PI_GOAL_GATE_COMMAND` before starting Pi. When configured, `goal_complete` executes that trusted command in the workspace and blocks completion on failure. The deprecated model-supplied `gate_command` parameter is ignored.

Liveness thresholds remain operator-only: `PI_GOAL_LIVENESS_SOFT_MS` and `PI_GOAL_LIVENESS_HARD_MS`, clamped to 1 second–24 hours (defaults: 5 and 15 minutes). Runtime failure, hard liveness timeout, explicit pause, or explicit stop still fail closed; automatic execution does not remove safety containment.

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
- Does not infer completion; the root agent must provide concrete evidence through `goal_complete`.
- Does not bypass explicit stop/pause, ownership, persistence, session-lineage, liveness, or trusted completion-gate safety boundaries.
- Does not replace Kanban or other project work tracking.
