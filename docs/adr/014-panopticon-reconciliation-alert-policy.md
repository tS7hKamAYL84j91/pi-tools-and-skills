# ADR 014: Panopticon Reconciliation Alert Policy

Status: Accepted

## Context

Panopticon reconciliation checks can run while the user and peer agents are idle.
Repeated stale-activity follow-ups consume context even when peers are healthy,
waiting, or actively heartbeating with no pending messages.

## Decision

Reconciliation findings are classified as actionable or informational.
Panopticon only injects user-visible follow-ups when a finding likely needs
intervention: pending messages, blocked agents, confirmed stale/stalled workers,
or silent termination before a `done`/`terminated` registry state.

A stale heartbeat sample or stalled status must be confirmed with a fresh
registry/status read before emitting a `stale-worker` alert. Stale workspace activity is suppressed
when all visible peers are operationally quiet: waiting/running/done, freshly
heartbeating, alive as expected, and with no pending messages.

## Consequences

- Healthy idle or long-running peers no longer produce repeated reconciliation
  follow-ups.
- Actionable peer states still interrupt promptly.
- Informational findings can still be recorded or batched with actionable
  findings, but should not be the sole reason for idle-noise alerts.
