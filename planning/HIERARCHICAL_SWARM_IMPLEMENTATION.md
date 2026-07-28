# ADR-040 hierarchical swarm implementation plan

## Phase 0: contracts and safety primitives

- Define manifest role templates and configurable hierarchical limits.
- Retain/add `eligibleModelsFor()` for every spawn boundary.
- Define typed runtime tree node/child-handle contracts and leaf spawn-denial.
- Add built-in `hierarchical-swarm-default` manifest.

## Phase 1: root protocol handler

- Register `protocol: "hierarchical-swarm"` in Teams.
- Create one root `TeamStateManager` run and in-memory tree.
- Implement root-only progress, terminal aggregation, TTL, cancellation, singleton ownership, and compact result formatting.

## Phase 2: dynamic tree execution

- Use a strict, fenced-JSON child-request protocol (`role`, `prompt`) from root and managers. Malformed or absent requests produce no children; they never trigger best-effort parsing.
- Represent the runtime tree as node-id paths and structured state details over the existing single `TeamStateManager` run; do not introduce a second lifecycle owner.
- Root/sub-manager spawn logic honors configured depth, total-node, child, WIP, TTL, model-safety, and write-isolation budgets. Omitted limits remain unbounded by platform policy.
- Every candidate model passes ADR-035 eligibility at each parent-to-child boundary. Private input with no explicitly local candidate escalates before spawn.
- Parent/child completion signals; silent exit blocks child. Leaf workers cannot interpret child requests.
- Leaf artifact, manager subtree, and root aggregate gates: manager and root make separate final review calls over their child outputs.

## Phase 3: compatibility

- `/swarm` / `swarm_run` delegate to `team_run id="hierarchical-swarm-default"`.
- Existing status/list/stop aliases delegate to Teams/runtime views.
- Remove old standalone runner from canonical path; no dual execution.

## Phase 4: acceptance

- Full hierarchy safety matrix from ADR-040.
- Independent FIRE review and full check/test/Semgrep gates.

## Non-negotiable checks

- Leaf cannot spawn.
- Every child model is eligible under ADR-035.
- No child can exceed a configured parent capacity; omitted capacities impose no platform numeric ceiling.
- Root alone closes the run and updates caller.
- Late/cancelled subtree events cannot change terminal root state.
