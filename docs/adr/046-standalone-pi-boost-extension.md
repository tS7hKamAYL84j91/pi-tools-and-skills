# ADR-046: Standalone pi-boost extension

## Status

Accepted — Principal-delegated decision, 2026-08-20. The LLM council was invoked twice but produced empty result artifacts; independent fallback review and repository fitness gates are retained as evidence.

## Context

ADR-045 introduced a privileged, bounded `/boost` lease under Panopticon. Boost controls model/runtime authority, durable recovery state, external configuration, and provider dispatch; those responsibilities are neither agent observability nor a bounded multi-agent workflow.

## Decision

Extract Boost into `extensions/pi-boost`. This supersedes ADR-045's component placement while retaining its authority, cap, reversion, and audit invariants.

`pi-boost` exclusively owns:

- `/boost` registration and Principal authorization;
- a persisted two-hour lease TTL, one global slot, and at most three human yields;
- per-dispatch governance, durable state, and redacted audit;
- host-injected provider dispatch;
- baseline reversion, recovery blocking, and shutdown cleanup.

Panopticon owns none of those capabilities. A team cannot mint or mutate a Boost lease.

Normal extension loading is fail-closed. Live behavior requires an explicitly reviewed host injection. The default identity source requires `PI_PRINCIPAL=1` and rejects sessions carrying the shared parent-agent marker. The reviewed host copies and freezes the read-only external Boost configuration reference before retaining it. An external publisher such as Q may later supply that Teams-shaped configuration, but it is not a Boost implementation dependency or authority.

Lease expiry is enforced lazily at command/runtime boundaries rather than by background activation. Expiry restores the baseline, appends a redacted audit record, and durably releases the global slot before another reservation proceeds.

```mermaid
flowchart LR
  P[Principal] --> C[pi-boost /boost]
  C --> A[Lease authority]
  A --> G[Governance and global slot]
  A --> E[Read-only external config adapter]
  A --> V[Injected provider runtime]
  A --> R[Baseline reversion]
  A --> S[Durable state and redacted audit]
  Q[Optional external publisher] -. config only .-> E
  X[Panopticon / teams] -. no authority .-> C
```

```mermaid
sequenceDiagram
  participant P as Principal
  participant B as pi-boost
  participant E as External config
  participant V as Provider runtime
  P->>B: /boost request
  B->>E: validate read-only config
  B->>B: authorize, govern, reserve
  B->>V: activate one bounded turn
  V-->>B: terminal outcome
  B->>B: restore baseline, audit, release
```

## Alternatives considered

- **Keep Boost in Panopticon:** rejected because it couples observability to privileged runtime mutation.
- **Implement Boost as a team:** rejected because teams coordinate workflows and must not own model-control authority.

## Consequences

Boost can be enabled, tested, and shut down independently. Panopticon remains an observability/orchestration extension. Provider deployment and credentials remain external injected capabilities. The extension never writes external configuration or changes the default model.

## Predicted impact

- Panopticon no longer registers `/boost` or participates in lease lifecycle.
- Boost tests and package discovery live under `pi-boost`.
- Default and delegated sessions fail closed; only an authenticated root Principal with reviewed host injection can dispatch.

## Validation

- Extension registration tests assert `/boost` belongs only to `pi-boost`.
- Authority, parser, lifecycle, persistence, external-config adapter, shutdown, TTL, and property tests live under `tests/boost/`.
- `npm run check`, `npm test`, and `git diff --check` must pass before delivery.
