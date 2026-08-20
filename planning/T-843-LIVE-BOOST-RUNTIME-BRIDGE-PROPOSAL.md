# T-843 Proposal: Live Boost Runtime Bridge

**Status:** design proposal only. It authorizes no implementation, Q configuration, provider dispatch, or live `/boost` enablement.

## Problem

Phase-4 review found that an extension-local `ExtensionAPI` command cannot safely own a live provider lease: normal extension loading supplies no deployable injected control object, provider dispatch has no lease lifecycle bridge, positive budget validation is not consumption, and Q revocation cannot cancel/revalidate an active dispatch. T-843 supplies the smallest runtime bridge consistent with T-826's daemon-backed/persistent-session direction without introducing a new scheduler, global default mutation, or bespoke configuration store.

## Decision shape

A host-owned runtime bridge provides a narrow, persisted-in-session capability to the Panopticon boost adapter. Panopticon remains a consumer; Q remains the owner of Teams descriptor/control records. The bridge is injected at extension start and is unavailable unless the host supports every required method.

```mermaid
sequenceDiagram
  participant Q as Q Teams control record
  participant P as Principal /boost
  participant C as Panopticon command
  participant B as Runtime boost bridge
  participant G as Governance classifier
  participant D as Cancellable provider dispatch
  P->>C: request
  C->>B: reserve(control reference)
  B->>Q: validate record + atomic budget
  B->>G: classify combined input
  B->>D: dispatch with AbortSignal
  Q->>B: revoke
  B->>D: abort active dispatch
  B->>B: restore baseline + audit
  B-->>C: terminal disposition
```

## Runtime bridge contract

The host supplies an injected `LiveBoostRuntimeBridge` with these capability families:

1. **Control resolution** — read-only resolve of a normal schema-v2 `protocol: boost` Teams descriptor and its descriptor-adjacent Q enablement record. It verifies expiry, signature/ownership, residency evidence, logical key consistency, and rollback version.
2. **Atomic budget** — compare-and-reserve/consume/release by `(enablementId, subjectId, leaseId)`, enforcing one global active lease, Q budget ceiling, and the three-yield maximum in one durable transaction. A failed operation changes nothing.
3. **Provider dispatch** — `dispatch(request, AbortSignal)` is the only provider seam. It emits one terminal event bearing lease id, activation generation, outcome, and human-visible status. It accepts no raw Q record, credential, or configuration path.
4. **Revocation and restore** — Q revoke, expiry, session shutdown, and provider failure cancel active dispatch through the same `AbortController`, then restore the captured selector baseline before another subject dispatch.
5. **Session persistence** — writes only bounded lease lifecycle state and redacted audit records to the host/session runtime state. It never writes root model defaults, Teams mappings, schedules, or prompts/transcripts.

## Lifecycle invariants

- Every provider request checks current Q control, atomic budget, and governance eligibility immediately before dispatch.
- Q revoke/expiry/rollback cancels the active request, blocks further subject dispatch, and restores baseline.
- A terminal human-visible response consumes exactly one yield; cancelled, failed, tool-only, and suppressed work consume none.
- Restore/audit/cleanup failure enters durable `RevertFailed`; every subject dispatch is blocked until Principal reset after Q control revalidation.
- Session shutdown calls bridge revocation/restore synchronously or leaves a durable blocked recovery marker; it never silently retains the lease selector.
- No child, schedule, background loop, or automatic reactivation can acquire the bridge.

## Teams/Q integration

Q control remains a normal Teams descriptor and descriptor-adjacent record, not a Panopticon/global config. The bridge receives logical control references only:

- `teamId: "q-boost"`
- logical keys `principalBoostBaseline` and `principalBoostLease`
- enablement id, mapping version, rollback version

The Q control-plan artifact must reproduce the bridge's control-resolution and rollback contract verbatim or identify council-approved deltas.

## Failure/rollback matrix

| Failure | Bridge action | Subject state |
|---|---|---|
| Control invalid/revoked/expired | deny before dispatch | normal baseline |
| Budget reservation failure | deny atomically | normal baseline |
| Governance private/local-only | deny before dispatch | normal baseline |
| Provider failure/cancellation | cancel + restore + audit | Reserved or Idle |
| Q revoke during dispatch | abort + restore + audit | Idle |
| Restore/audit/cleanup failure | durable `RevertFailed` | all dispatch blocked |
| Host bridge unavailable | inert command denial | no mutation |

## Tests required before implementation

### Deterministic/mock

- Atomic race tests across two sessions/subjects and budget rollback on every failed step.
- Q revoke at pre-dispatch, active dispatch, terminal-yield, and reactivation boundaries.
- `AbortSignal` propagation and one terminal outcome only.
- RevertFailed persistence, subject blocking, reset/revalidation, and shutdown recovery marker.
- Control/key/residency/signature/version mismatch fail-closed tests.
- No writes to root defaults, Teams mapping, schedules, prompts, or transcripts.

### Controlled real validation (only after Q plan approval)

- Q dry-run resolver with no provider selection.
- One Principal-approved, non-sensitive fixture within a two-hour Q record, one global lease, and at most three yields.
- Q-triggered revoke/rollback during a controlled dispatch proves abort, restore, audit, and inert fallback.

## Explicit exclusions

- No implementation in this proposal.
- No direct extension-level provider dispatch or `ExtensionAPI` workaround.
- No new scheduler, background service, child activation, root default mutation, or bespoke global control file.
- No credentials/tokens/Q records committed to this repository.

## Approval gate

Council review is required because this adds a runtime/provider control surface and persistent lifecycle state. Q must supply a bridge-compatible control plan and dry-run/rollback runbook. Principal/Gravitas must separately approve implementation after those artifacts pass review.
