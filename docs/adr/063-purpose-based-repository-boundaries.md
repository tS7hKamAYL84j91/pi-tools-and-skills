# ADR-063: Purpose-based repository boundaries

## Status

Accepted for implementation by Jim's “complete 1–4” Goal, 2026-09-27.

## Context

The root README, architecture reference and completed TODO narratives repeated
usage information. The architecture reference also retained superseded Boost
and Goal descriptions. Library fitness checks counted tests as consumers, while
size/cohesion/co-change gates required mechanical splitting or budget updates
without demonstrating a better boundary.

## Decision

1. Root README is navigation; package READMEs own usage; architecture owns
   cross-cutting boundaries. ADRs retain decision history. Completed checklists
   remain in Git history instead of a second current work queue.
2. Inventory production consumers in `lib/README.md`. Move the two Teams-only
   live-agent runtime adapters into Teams; retain generic security/persistence/
   transport and documented single-consumer infrastructure centrally. Library
   tests no longer count test imports as evidence of production use.
3. Group Goal/Teams evaluation runners and guides in `benchmarks/`, outside
   shipping runtime and package contents. Preserve npm command names, CLI
   arguments, defaults, opt-in controls, offline tests and evidence policies.
   Direct `scripts/` runner paths and internal Python imports move; there are no
   forwarding wrappers.
4. Retire line-size budgets, forced hotspot reductions, co-change budgets,
   regex parameter quotas and LCOM thresholds as CI gates. Preserve structural
   entrypoint placement and all dependency/cycle, private-state, confinement,
   transaction, permission, API, verification and UI safety checks.

## Consequences and limits

Raw metrics can still guide an explicitly requested forensic review. They are
not proof of a defect or grounds for merging code and tests. Boundary tests
remain deterministic and no longer depend on local Git history, a remote merge
base, or rolling date windows.

This does not authorize feature retirement, live configuration changes, altered
model/profile defaults, benchmark runs against live providers, new schedulers,
or session-history cleanup. Teams behavior simplification (proposal 5) remains
outside scope.

Previous architecture diagrams and completed TODO records can be read at
`18b711a:docs/architecture.md` and `18b711a:TODO.md`. Historical ADRs remain
unchanged; library import paths mentioned there describe their decision-time
layout. This decision changes maintenance policy and placement, not runtime
safety semantics.
