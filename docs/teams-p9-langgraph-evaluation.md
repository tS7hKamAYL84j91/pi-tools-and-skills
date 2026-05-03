# P9 LangGraph evaluation for pi-teams

## Context

The P7 team-local protocol-contract direction was getting too complex: it pushed prompt slots, model slots, form hints, and lowering policy into a second mini-language instead of simplifying execution. This evaluation moves the LangGraph question forward before adding more custom protocol machinery.

## Current custom executor responsibilities

`extensions/pi-teams/team-graph.ts` currently owns:

- DAG validation: duplicate roles, unknown edge endpoints, cycles, disconnected graphs, output validation.
- Scheduling: deterministic topological levels, bounded concurrency, parent cancellation, per-node timeouts.
- Retry policy: bounded retries on child-call failures, no retry on timeout/parent cancellation.
- Node packaging: default upstream-output package and template rendering.
- Node execution bridge: one-shot `pi --print` model child process via `runMember()`.
- Result reduction: ordered output blocks for configured graph outputs.

`extensions/pi-teams/team-lowering.ts` currently owns protocol-specific lowering for built-in workflows:

- fanout + critique + synthesis planning,
- bounded review/fix unrolling,
- single-node consult,
- linear relay.

## LangGraph mapping

LangGraph can plausibly replace the lowest-level graph scheduling and state-transition loop:

| Current code | LangGraph fit | Notes |
|---|---:|---|
| topological node execution | High | LangGraph already models nodes/edges and execution state. |
| fanout/join execution | High | Debate fanout and synthesis join map naturally. |
| bounded static unrolling | Medium | Pair review/fix can compile to a finite graph before execution. |
| retry wrappers | Medium | LangGraph supports retry-style policies, but Pi semantics still need tests. |
| timeouts/cancellation | Medium | Likely still needs Pi-side AbortSignal wrappers around node functions. |
| output reduction | Low/Medium | Easy either way; keep Pi-specific reducer for inspectable output. |
| prompt packaging | Low | This is Pi/team-specific and should remain explicit TypeScript. |
| session events | Low | Pi must still write `pi-teams:run` events around node lifecycle. |
| live `agent:<name>` routing | Low | LangGraph can call a node function, but Panopticon messaging remains Pi-specific. |

## What would remain Pi-specific

Even with LangGraph, pi-teams still needs small adapters for:

1. Building a node function from a `TeamAgentBinding`.
2. Rendering system/template prompts and upstream outputs.
3. Calling one-shot model children through `runMember()`.
4. Calling live agents through Panopticon/Maildir when P8 lands.
5. Recording bounded session events in `TeamStateManager`.
6. Formatting `team_run` tool results and `team_describe` inspection output.

LangGraph should not own these concerns; hiding them in opaque callbacks would reduce inspectability.

## Dependency and operational risk

`@langchain/langgraph` currently resolves as a small direct dependency set (`@langchain/langgraph-checkpoint`, `@langchain/langgraph-sdk`, `@standard-schema/spec`, `uuid`), but it is still a new runtime dependency in a Pi extension. Before accepting it, verify:

- ESM compatibility under Pi's jiti extension loader.
- Node version compatibility for this repo's supported runtime.
- AbortSignal behavior under node timeouts and user Esc cancellation.
- Deterministic execution order for same-level graph nodes where tests expect stable output ordering.
- Error surfaces are clearer, not harder, than the current small executor.

## Recommendation

Do not continue the P7 mini-protocol/manifest DSL as-is. It is more complex than the problem warrants.

Run a narrow LangGraph spike first:

1. Keep current team manifests unchanged.
2. Add a branch-only `team-langgraph-spike.ts` that compiles existing `TeamSpec.graph` to LangGraph.
3. Convert only the explicit graph tests first: validation, fanout, skipped dependents, retry, timeout, cancellation, output reduction.
4. Then test one lowered built-in workflow through the same adapter.
5. Count deleted custom code vs added adapter code.

Accept LangGraph only if the spike deletes most of `team-graph.ts` scheduling/retry code without moving complexity into larger adapters. If the adapter grows beyond the current executor, keep the in-repo DAG executor and simplify P7 by deleting the protocol-contract expansion rather than adding a framework.

## Decision gate

Proceed only after the spike proves all of these:

- `npm run check` and `npm test` green.
- Session event semantics unchanged.
- Timeout, retry, cancellation, and skipped-dependent behavior unchanged.
- Team behavior remains inspectable from team files and `team_describe`.
- Net code is smaller and simpler.
