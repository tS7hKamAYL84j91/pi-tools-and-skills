# ADR 042: CoAS scheduled approval resume

## Status

Accepted — 2026-08-02

## Decision

A gated scheduled delivery has one explicit run-based `requestId`
(`<taskId>-<runId>`) for its approval artifact and run-state claim-check. Principal approval resumes that parked run
directly in the pi-hosted scheduler; it does not create a second scheduled run.

The approval lifecycle is terminal and idempotent: `awaiting-approval` may become
`approved`, `rejected`, or `deferred`; an approved delivery becomes `completed`
or `interrupted` after execution. Repeating a terminal decision returns the
existing artifact without rewriting the decision. Deferred requests retain their
parked run so a later approval can resume it.

Run-state is written before message delivery. Delivery failures are recorded as
`interrupted`, preventing a crash from leaving a false running claim. Schedule
removal deletes the schedule, run-state, and approval artifacts for that task.
Approval prompts and decisions are bounded, control-character sanitized, and
redact common credential-shaped values. Terminal approval artifacts are retained
only within a bounded age/count policy.

## Consequences

- Approval tools need the current scheduler's narrow resume callback.
- Approval artifacts remain private claim-checks, not an audit log.
- Scheduler telemetry remains ephemeral; continuation state remains one snapshot
  per task rather than a history array. The scheduler snapshot exposes the current
  durable awaiting-approval count for operator visibility.
- The scheduler is split into orchestration, run-once, approval, recovery, and
  state modules so architecture fitness line budgets remain enforceable.
