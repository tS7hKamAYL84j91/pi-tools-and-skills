# Runtime Lifecycle Hardening

## Goal

Correct three verified lifecycle/error-contract defects with behavior-preserving tests:

1. `spawnRuntimeChildProcess` must bound captured output, honor pre-aborted signals, wait for child close after cancellation, and escalate TERM to KILL after a bounded grace period.
2. CoAS `session_shutdown` must await interrupted-run persistence before clearing scheduler state.
3. `coas_approval_approve` must return failure when approved-run resume returns `false`.

## Constraints

- Preserve successful child-process result shape and ordinary exit behavior.
- Use native Node APIs; no dependencies.
- Captured stdout/stderr limits and kill grace must be bounded constants and deterministic in tests.
- Cancellation completion means the child has closed (or escalation completed), not merely that SIGTERM was requested.
- Make scheduler `stop()` asynchronous and update all callers/tests.
- Approval artifact may remain approved, but the tool must clearly report delivery/resume failure; do not falsely return success.
- No fitness exemptions or public schema changes.

## Implementation constants

- Capture at most 256 KiB per stdout/stderr stream, including a truncation marker.
- Escalate cancellation from `SIGTERM` to `SIGKILL` after 250 ms.

## Acceptance criteria

- Tests cover pre-abort, TERM-responsive child, TERM-ignoring child escalated to KILL, bounded output, and no premature resolution.
- CoAS lifecycle test proves shutdown awaits `stop()`; run-state test proves active runs are persisted before reset.
- Approval handler test proves `resumeApprovedRun() === false` returns failed tool result.
- Focused tests, architecture tests, `npm run check`, `npm test`, and `git diff --check` pass.
