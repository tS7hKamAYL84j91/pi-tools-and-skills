# ADR-039: Declarative swarm Team protocol

## Status

Accepted — council recommendation adopted on user authorization, 2026-07-28.

## Context

ADR-036 placed `/swarm` beside `teams/` as a standalone Panopticon primitive. The user-directed redesign requires explicit manifest control over worker roles, local-model bindings, tool allowlists, review bindings, and execution bounds. The standalone runner also lacks the normal Teams state, interaction, and terminal-result lifecycle.

The prior council recommendation to amend ADR-036 applied only to incremental standalone lifecycle completion. This decision reverses ADR-036's central placement and invocation choice, so an amendment would obscure the audit trail.

## Decision

Introduce first-class `protocol: "swarm"` in the existing Teams architecture.

- Add optional `swarmConfig` to the Team manifest schema, valid only for `protocol: "swarm"`.
- `swarmConfig` declares worker role/model/tool bindings, review-team bindings, profile defaults, WIP/TTL/repair limits, and write-isolation policy.
- Add `team-handler-swarm.ts`; it reuses deterministic planner, gates, and reconciler utilities but owns execution through `TeamStateManager`, `runTeamNode`, and existing team runtime paths.
- Seed a built-in `swarm-default` manifest reproducing ADR-036 hard bounds.
- ADR-035 classification is the outer safety constraint. Manifest model bindings select only from eligible models; private input without an eligible local model blocks/escalates.
- Swarm runs are session-scoped Team runs. No `swarm_resume` or separate persistence store.
- `/swarm` and `swarm_run` become compatibility aliases delegating only to `team_run id="swarm-default"`; no second orchestration path remains.
- `swarm_status`, `swarm_list`, and `swarm_stop` delegate to existing team/runtime status controls filtered by `protocol: "swarm"`.

## Consequences

### Positive

- Explicit, reusable model/tool/review policy for each swarm role.
- Swarm interaction, progress, cancellation, state, and terminal results align with Teams UX.
- Existing team state and runtime controls remain the sole lifecycle authority.

### Constraints

- ADR-036 hard bounds remain immutable manifest ceilings: WIP ≤3, one-time deterministic decomposition, max three repairs, TTL ceilings, artifact gates, no peer-to-peer workers, and parallel-write isolation.
- Structural manifest validation, plan-time model eligibility validation, and spawn-time safety checks are all required.
- Review results must remain recorded under the parent swarm Team run; nested standalone team runs are not the primary audit record.

## Supersession

This ADR supersedes ADR-036 **Placement** and **Invocation surface** sections after migration. ADR-036 bounds, gates, provenance, and safety constraints remain in force.

## Preconditions

1. Define additive governance `eligibleModelsFor()` API without changing `maybeGovernanceRoute` behavior.
2. Specify `swarmConfig` schema and compile-time validation.
3. Specify write-isolation mechanics and repair-node provenance.
4. Confirm singleton active-swarm policy and kanban tag compatibility.

## Validation

- Manifest structural, plan-time, and spawn-time model safety tests.
- TeamStateManager progress, cancellation, final-result, TTL, and write-isolation tests.
- Alias compatibility tests.
- `npm run check`, `npm test`, and `npm run security:semgrep` pass without exemptions.
