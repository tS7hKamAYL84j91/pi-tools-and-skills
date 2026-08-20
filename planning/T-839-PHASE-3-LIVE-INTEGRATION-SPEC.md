# T-839 Phase 3: Live `/boost` Integration Specification

**Status:** proposal only. No live dispatch, model/config/default change, or Q action is authorized by this document.

## Goal

Promote the inert ADR-045 command slice to a Principal-authorized live lease only after council approval and a Quartermaster (Q) control plan. Preserve the existing command/parser/authority contracts and fail closed whenever a live prerequisite is absent.

## Boundaries

- Principal authorization is necessary but insufficient: a valid Q enablement record, configured Teams model mapping, budget decision, governance eligibility, and audit sink are all required before a live dispatch.
- No root model/default, residency, scheduler cadence, schedule, or global configuration mutation is performed by `/boost`.
- The inert phase remains the fallback. Missing/invalid enablement returns a bounded denial and never attempts a provider call.
- Phase 3 introduces no automatic reactivation, background dispatch, or child-agent delegation.

```mermaid
sequenceDiagram
  participant P as Principal
  participant B as /boost command
  participant A as Lease authority
  participant Q as Q enablement record
  participant G as ADR-035 governance
  participant T as Teams model resolver
  participant S as injected selector
  P->>B: request
  B->>A: reserve
  A->>Q: verify enabled + budget
  A->>G: classify combined input
  A->>T: resolve configured baseline/lease
  alt every gate passes
    A->>S: select lease model for active turn
    S-->>A: result
    A->>S: restore captured baseline on yield/failure
  else any gate fails
    A-->>P: bounded denial; no provider dispatch
  end
```

## Teams-configured model resolution

1. Add no hard-coded provider/model identifiers to Panopticon.
2. Resolve `principalBoostBaseline` and `principalBoostLease` through a Q-owned Teams/runtime model catalog adapter. The adapter returns a registered model identity, locality/provider metadata, and an immutable selector handle.
3. Q must map the logical policy keys to the approved GLM baseline and Sol lease model in the Teams-controlled configuration surface. The actual value change is a separate Q-controlled action with a rollback record.
4. A missing, stale, unregistered, family-mismatched, or residency-ineligible model denies reservation/activation. It does not substitute another configured default.

## Principal and Q authority

- `PrincipalAuthorization`: verifies the caller is the designated Principal at reserve, status, reset, and every reactivation.
- `QEnablement`: a signed/local control record with enablement id, allowed lease model key, maximum active leases (one), maximum human yields (ADR cap of three), expiry, budget ceiling, and rollback version.
- Q may enable/disable the record and update the Teams mapping only through its controlled change procedure. Panopticon reads the record; it never writes model configuration.
- Expired, revoked, malformed, or unavailable Q records deny activation and force normal reversion when a lease is already active.

## Injected live boundaries

Phase 3 replaces only the phase-2 inert adapters with injected interfaces:

- `LiveModelResolver` (Teams/Q configuration read only)
- `LiveModelSelector` (select/restore only for the leased subject)
- `GovernanceClassifier` (ADR-035 combined-input classification)
- `LeaseBudgetAuthority` (Q record decision/recheck)
- `LeaseAuditSink` (redacted, append-only local record)
- `LiveIsolationAdapter` (creates/disposes `--clean`/`--fresh` contexts without history or hidden-state inheritance)
- `LiveWorkspaceValidator` (revalidates the captured workspace identity before every activation)
- `LiveDispatchBoundary` (the sole provider-dispatch seam)

`BoostModelAdapter` splits into the read-only `LiveModelResolver` and the subject-scoped `LiveModelSelector`. The added immutable selector handle plus locality/provider/residency metadata are new phase-3 contract types; they require independent type/API review and cannot be inferred from the current `BoostModelIdentity`.

The command module must continue to depend only on narrow interfaces. Provider SDKs, credentials, raw model configuration, schedules, and network clients remain outside its dependency graph.

## Budget, audit, and reversion

- Check Q budget at reservation and before every activation. The Q record's allowed lease key must exactly equal the `principalBoostLease` key resolved by the Teams adapter; a mismatch is a fail-closed denial. A denial consumes neither budget nor human yield.
- Cancelled, failed, tool-only, and suppressed-never-yielded dispatches consume neither budget yield nor human-yield count. Only a terminal response available to the human decrements the lease.
- The audit record contains opaque ids, logical policy keys, state transitions, yields, enablement id, and bounded failure category; never prompt, output, provider error body, token payload, credential, or workspace contents.
- After every terminal human-visible yield, restore the captured baseline before another dispatch. Re-check Principal/Q/governance/budget before reactivation.
- A selection, dispatch, audit-finalization, cleanup, or restore failure enters `RevertFailed`, blocks subject dispatch, and requires Principal reset after Q enablement is revalidated.
- Q disable/revocation triggers reversion; it must not terminate unrelated agents or schedules.

## Failure and rollback

| Event | Required result |
|---|---|
| Q record unavailable/revoked | deny or revert; retain inert command |
| Teams mapping/model invalid | deny; no selector/provider call |
| Private/local-only ADR-035 result | deny; no live lease dispatch |
| Selector/provider failure | revert captured baseline; audit bounded category |
| Baseline restore failure | `RevertFailed`; block subject until Principal reset |
| Q rollback | restore prior Q mapping/record version; invoke reversion for active lease; verify inert fallback |

## Required live contracts

### Teams model adapter

The Q control plan must define a read-only `LiveTeamsModelAdapter.resolve(key)` result: exact logical key, registered provider/id/family, verified locality/residency metadata, immutable selector handle, mapping version, and expiry. It must reject missing, duplicate, stale, family-mismatched, or Q-key-inconsistent results. The adapter never writes configuration or probes providers.

### Live dispatch boundary

The Q control plan must define `LiveDispatchBoundary.dispatch(grant)` and its terminal callback contract: subject/activation generation binding, one terminal outcome, human-visible-yield signal, bounded failure category, cancellation handling, and mandatory baseline restoration sequencing before any subsequent dispatch. It cannot receive raw Q credentials or configuration.

## Q control plan required before implementation

1. Q identifies the Teams configuration owner/path, Q-record storage and signing/verification mechanism, and records the approved logical-key mapping, provider/residency evidence, expiry, budget-ceiling composition with the three-yield cap, and rollback version.
2. Q prepares a dry-run validation that resolves both keys without selecting or calling a provider.
3. Q obtains Principal confirmation for the specific enablement window and budget ceiling.
4. Q supplies a rollback runbook: disable record, revoke lease key, restore prior mapping, verify no active lease, and retain audit evidence without secrets.
5. Q documents controlled-real fixture vetting and the Principal reset ceremony/audit evidence required after `RevertFailed`.
6. Council reviews this specification plus Q's control plan before any configuration mutation or real dispatch test.

## Tests

### Mock/CI

- Principal/Q enablement matrix: absent, expired, revoked, wrong issuer, cap/budget denial.
- Teams model mapping: missing, invalid, family/provider/residency mismatch, exact logical keys, no substitution.
- Governance: public eligible versus private/local-only denial over the combined frame/prompt.
- Selector dispatch/revert ordering; per-yield restoration; `RevertFailed` behavior; disable/revocation rollback.
- Audit redaction and no command dependency on provider/config/scheduler/network modules.

### Controlled real validation (post-Q/council only)

- Q dry-run resolver, no selection/provider call.
- One Principal-approved, budget-capped lease using a non-sensitive fixture; verify audit, yield decrement, baseline restore, and Q rollback.
- A forced controlled failure path that proves no silent fallback/model drift.

## Approval gate

Council must approve this specification and Q's concrete control plan. Gravitas must record the approval disposition. Only then may a separately scoped live-integration implementation begin.
