# ADR-040: Bounded hierarchical swarm orchestration

## Status

Accepted — user-directed redesign and llm-council recommendation, 2026-07-28.

## Context

ADR-036 implemented a flat, standalone worker pool. ADR-039 proposed a fixed declarative Teams protocol. Neither expresses the required hierarchy: a root orchestrator may choose to spawn sub-orchestrators or leaf workers; sub-orchestrators may spawn managers or workers within inherited limits; leaf workers cannot spawn.

The hierarchy must preserve ADR-036 safety bounds while allowing bounded dynamic decomposition of an assigned subtree.

## Decision

Implement `protocol: "hierarchical-swarm"` as a Teams protocol backed by runtime child entities within **one root `TeamStateManager` run**.

### Authority

| Role | Spawn authority | State authority |
| --- | --- | --- |
| Root orchestrator | managers and workers | sole terminal/caller-facing owner |
| Sub-orchestrator | managers and workers within inherited limits | reports upward only |
| Leaf worker | none | reports to direct parent only |

Leaf tool allowlists exclude spawn, team, and swarm-management tools. Communication is strictly parent/child; no peer mesh.

### Configurable limits

The built-in manifest supplies conservative defaults for depth, children per node, total nodes, WIP, repair cycles, and TTL. Users/project manifests may override or omit those numeric limits; the platform imposes no immutable numeric ceiling at this stage.

When a parent declares a limit, its children inherit the remaining capacity and cannot mint more of that parent-declared capacity. Model-safety policy and write-isolation policy are always inherited. Write isolation is tree-global: only one write-enabled node runs at a time unless an approved worktree policy applies.

### Model safety

At every spawn boundary, ADR-035 classification produces an eligible model set. Manifest role preference selects only within that set. A private child brief without an eligible local model is blocked/escalated; it never falls back to cloud.

### Lifecycle and review

- The root owns the only Team run, timer, cancellation propagation, compact caller updates, and first-writer-wins terminal state.
- The runtime keeps an in-memory parent/child tree for v1 while recording flat Team nodes/details in `TeamStateManager`.
- Leaves pass artifact evidence gates; managers review compact subtree summaries; root applies final aggregation review.
- Root terminal completion tears down runtime children and releases the active swarm singleton.

### Compatibility

`/swarm` and `swarm_run` remain compatibility aliases to the canonical `team_run id="hierarchical-swarm-default"` path. They must not invoke an independent orchestration path.

## Consequences

- Manifest role templates express worker/manager models, tools, review bindings, and policy, while topology remains runtime-selected within fixed limits.
- Teams gains a hierarchical protocol without nested independent TeamStateManager runs.
- Implementation is more complex than a flat pool; all capacity, cancellation, and late-event handling must be centralized at the root.

## Supersession

- ADR-035 is unchanged and remains the outer model-safety policy.
- ADR-036 is partially superseded for placement, flat-pool topology, its prohibition on dynamic decomposition, and immutable numeric ceilings. Its gates, provenance, write isolation, and model-safety constraints remain inherited.
- ADR-039 is fully superseded before implementation.

## Validation

- Spawn-boundary model eligibility and leaf tool-denial tests.
- Configured depth/child/total-node/WIP/TTL inheritance tests, including omitted-limit behavior.
- Parent-child-only communication and root-only terminal state tests.
- Three-tier gate, cancellation, late-completion, write-isolation, and alias compatibility tests.
- `npm run check`, `npm test`, and `npm run security:semgrep` pass without exemptions.
