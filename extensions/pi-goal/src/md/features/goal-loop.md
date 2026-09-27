# Goal loop contract

## Inputs

A goal has a project-local objective, a stable goal ID, an owner claim, and a
turn budget. A zero budget means unbounded continuation until an explicit stop,
completion, or runtime failure; positive budgets are bounded turn counts.

## One turn

1. Wait for the host session to become idle.
2. Reload authoritative state and verify the owner claim.
3. Admit the turn transactionally.
4. Dispatch the kickoff or continuation prompt.
5. Wait for the agent result.
6. Record progress, changed files, and the run iteration.
7. Re-read state before the next turn.

Any uncertain delivery, ownership mismatch, workspace mismatch, or persistence
failure pauses the goal. The loop must not blindly replay an uncertain turn.

## Completion

Completion is a request, not an inference. The trusted verifier runs in the
workspace with a bounded timeout. Exit zero passes; a normal rejection pauses
(or repairs only when the operator has explicitly configured repair attempts).
Other execution errors pause for inspection.

## Replacement sessions

A replacement reserves the next attempt before switching sessions. The new
session must prove the same workspace and goal binding, then consume the
reservation exactly once before receiving the continuation prompt.

## Test mapping

- ownership and ABA prevention: `tests/goal/goal-ownership*.test.ts`
- replacement/session lineage: `tests/goal/pi-goal-continuous-liveness.test.ts`
- completion gate: `tests/goal/pi-goal-gate-command.test.ts`
- persistence/projection: `tests/goal/pi-goal-tools.test.ts`
