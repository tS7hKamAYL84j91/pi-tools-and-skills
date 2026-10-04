# Pi Goal Extension

Project-local goal execution: start immediately, continue until completion or an
explicit stop, and validate completion with a locally configured hook.

## Commands

- `/goal <text>` / `/goal file <path>` — start a text/file-backed goal immediately.
- `/goal status` — inspect state; `/goal run` / `/goal resume` — resume.
- `/goal run --turns N` — bounded 1–20 turns; default is unbounded continuation.
- `/goal pause` / `/goal stop` — stop independently of hook configuration.
- `/goal steer <text>` / `/goal edit <text>` — current guidance/objective edits.
- `/goal hook` — edit completion-hook command/timeout JSON in Pi's native TUI editor.
  Cancel leaves settings unchanged; a conflicting save is rejected.
- `/goal hook <command>` — set the command locally, retaining the current timeout.
- `/goal clear` — remove recognized goal artifacts, preserving hook settings and
  unknown files. It does not delete the original source or unrelated history.

No generated plan, milestone approval or pre-session environment setup is required.
Explicit stop/pause and bounded turn counts remain authoritative.

## Tools

- `goal_get` — state and whether the local hook is configured, missing or invalid.
- `goal_hook` — inspect settings, or set `command` and optional `timeout_ms`;
  optional `expected_revision` rejects stale saves (`absent` / `invalid` for those
  states). Saving never executes the hook. Authorized local agents may amend it.
- `goal_complete` — audit requirements, provide evidence, then execute the hook.
- `goal_block` — pause for a genuine missing input/permission/resource, not an
  ordinary repairable validation failure.

The root agent owns completion. Workers report DONE/BLOCKED to the root.
The deprecated `goal_complete.gate_command` input remains inert.

## Local completion hook

Settings live in **`.pi/goal/settings.json`**, beside the workspace's goal state:

```json
{
  "schemaVersion": 1,
  "revision": "generated-on-save",
  "command": "npm run check && npm test && git diff --check",
  "timeoutMs": 900000
}
```

Use the TUI or `goal_hook` to generate revisions safely. No credentials belong in
commands. Tool feedback and persisted hook output are bounded and secret-redacted.
Settings are private, atomically replaced, locked, and reject symlink components.
They are shared by goals in this workspace, not global or tied to a session's
startup environment. They persist across reload/resume/clear.

`goal_complete` runs the configured shell command in the workspace. Only exit zero
can complete; evidence prose is never a substitute. A missing/invalid/failed hook
is declared and leaves the goal open for local configuration or repair. Each
explicit completion request runs one bounded check; there is no automatic retry
or run-wide repair budget. Timeout defaults to 15 minutes, range 1 second–24 hours.

Changing settings invalidates an in-flight result, even when the command is changed
back. Another completion request runs the current hook. Stops, edits and ownership
changes still reject stale authority commits. Completed goals never reopen merely
because settings change: their receipts remain historical evidence of the exact
configuration checked, not reusable validation for future goals.

This is **local validation, not independent operator approval**: agents can amend
it within granted scope, but must never weaken checks to conceal unfinished work.
`PI_GOAL_GATE_COMMAND`, `PI_GOAL_GATE_TIMEOUT_MS` and `PI_GOAL_REPAIR_ATTEMPTS` no
longer configure completion. Existing environment settings are not auto-migrated;
set the desired hook locally and explicitly resume a previously paused goal.

## Ownership, liveness and recovery

Only the claimed local driver dispatches turns. Low-level `agent_end` events
are collected until `agent_settled`; only then does a final error pause the goal
or a successful turn permit session replacement. Ownership uses opaque tokens,
monotonic generations and revision checks, never implicit TTL/PID takeover.
Replacement sessions preserve workspace, goal binding and native session lineage;
uncertain delivery/persistence failures pause rather than blindly replaying work.

Liveness defaults and operator-owned `PI_GOAL_LIVENESS_SOFT_MS` /
`PI_GOAL_LIVENESS_HARD_MS` are unchanged: idle diagnostics never stop productive
work based only on elapsed time. Use explicit pause/stop and inspection for recovery.

## Runtime files

Workspace configuration is `.pi/goal/settings.json`. Session-bound goals live in
`.pi/goal/instances/<goalId>/`:

- `goal.json` — authoritative state, including the last completion check.
- `GOAL.md` — derived summary with bounded reported activity/changed files.
- `runs/YYYY/MM/DD/*.{jsonl,md}` — per-invocation records.

Legacy state remains readable. File goals keep the original source path without
copying it; text goals store their objective. Loading/resuming preserves original
sources and session/run history. Settings edits do not claim or resume a goal.

## What this does NOT do

- No global verifier configuration, generated plans or implementation approval gates.
- No implicit completion, ownership takeover, or resume after explicit stop/pause.
- No claim that an agent-editable hook is independent operator approval.
- No bypass of task scope, permissions, session lineage, filesystem confinement,
  cancellation or output/secret boundaries.
- No model-default, residency or operational schedule changes.
