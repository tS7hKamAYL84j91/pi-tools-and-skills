# ADR-046: Standalone pi-boost extension

## Status

Proposed

## Decision

Extract the mutable `/boost` authority from pi-panopticon into `extensions/pi-boost`. The standalone extension owns registration, Principal authorization, lease lifecycle, bounded persistence and audit, Q runtime adaptation, reversion, and shutdown. Panopticon remains an observation and swarm extension and does not register boost behavior.

```mermaid
flowchart LR
  P[Principal] --> C[pi-boost /boost]
  C --> A[Lease authority]
  A --> G[Governance and global slot]
  A --> Q[Q runtime adapter]
  A --> R[Reversion]
  A --> S[Audit and durable state]
```

```mermaid
sequenceDiagram
  participant P as Principal
  participant B as pi-boost
  participant Q as Q runtime
  P->>B: /boost request
  B->>B: authorize and reserve
  B->>Q: activate one bounded turn
  Q-->>B: terminal outcome
  B->>B: restore baseline and audit
```

## Consequences

Boost can be enabled, tested, and shut down independently. Panopticon cannot mint or mutate leases; all existing Principal authority and fail-closed reversion rules remain in the extracted domain.
