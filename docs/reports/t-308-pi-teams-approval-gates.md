# T-308 pi-teams Approval Gates POC

Date: 2026-05-22

## Summary

T-308 adds provisional approval gate primitives for pi-teams workflows and Oracle-style safety reviews. The slice is intentionally small: it defines request/result/state shapes, emits auditable `run_detail` events, blocks continuation unless approved, and maps approval states into the T-309 observability surface.

Artifacts:

- `extensions/pi-teams/approval-gates.ts` — approval request/result/state helpers.
- `tests/team-approval-gates.test.ts` — approval-required, approved, rejected, expired, and invalid-record tests.
- `extensions/pi-teams/observability.ts` — accepts `approval: "expired"` as an approval result.

## Schema

Approval request required fields:

- `schemaVersion: 1`
- `gateId`, `runId`, `teamId`
- optional `phaseId`, `nodeId`
- `action`
- `risk`: `medium | high | critical`
- `owner`
- `source`: `human | orchestrator | policy`
- `reason`
- optional `expiresAt`, `artifactUri`

Approval result required fields:

- `schemaVersion: 1`
- `gateId`, `runId`
- `status`: `approved | rejected | expired`
- `decidedBy`, `decidedAt`
- optional `reason`

State flow:

```text
proposed -> awaiting_approval -> approved -> executed
                             -> rejected -> stopped
                             -> expired  -> stopped
                             -> missing  -> stopped/requires_approval
```

## Policy boundary

Interrupt points are high-risk/mutating tool calls or high-risk Oracle decisions selected by the team/orchestrator. Matrix may notify humans, but it is not the policy engine. The approval source/owner/result must be recorded in local team state before continuation.

Default behavior is fail-closed: missing, rejected, expired, or mismatched approvals stop continuation and record an auditable stopped state. Expiry defaults to no expiry unless `expiresAt` is set; if set and `now > expiresAt`, even an approved gate cannot proceed.

## Example transcript / SOP

1. Team reaches a mutating action: `run mutating deployment command`.
2. `requestTeamApproval` records `approval required` with risk, owner, source, and reason.
3. Operator reviews artifact/context out-of-band.
4. If approved, `resolveTeamApproval(... status: "approved")` records result and downstream action can run.
5. If rejected/expired/missing, `executeAfterApproval` does not invoke downstream action and records `run_stopped`.

## Before / after behavior

Before: team code could represent stops/errors, but there was no explicit approval request/result state flow.

After: approval-required and approval-result events are explicit in team state and visible through T-309 observability as `approval_required`, `approval_result`, and stopped `requires_approval` outcomes.

## Relationships

- **T-269 CoAS structured results:** this POC mirrors `requires_approval` fail-closed semantics for team workflows.
- **T-309 observability:** approval request/result/stopped states are emitted through `run_detail` and mapped into structured observability primitives.
- **T-491 session spooling gates:** any future real hook/default install or unredacted output mode can use this gate shape before activation.
- **Future Oracle workflows:** Oracle can use this as the local policy trace while Matrix remains notification-only.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this is a provisional helper/state-flow POC, not a durable approval policy engine or mandatory runtime gate. ADR becomes required before wiring gates into default pi-teams execution, mutating tool authorization, external notifications, or organization-wide approval policy.
