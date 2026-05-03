# P9 LangGraph evaluation for pi-teams

## Context

The P7 team-local protocol-contract direction was getting too complex: it pushed prompt slots, model slots, form hints, and lowering policy into a second mini-language instead of simplifying execution. This evaluation moved the LangGraph question forward before adding more custom protocol machinery.

## Current custom executor responsibilities

`extensions/pi-teams/team-graph.ts` currently owns:

- DAG validation: duplicate roles, unknown edge endpoints, cycles, disconnected graphs, output validation.
- Scheduling: deterministic topological levels, bounded concurrency, parent cancellation, per-node timeouts.
- Retry policy: bounded retries on child-call failures, no retry on timeout/parent cancellation.
- Node packaging: default upstream-output package and template rendering.
- Node execution bridge: one-shot `pi --print` model child process via `runMember()` and live `agent:<name>` nodes via the Maildir runner.
- Result reduction: ordered output blocks for configured graph outputs.

`extensions/pi-teams/team-lowering.ts` currently owns protocol-specific lowering for bundled workflows:

- fanout + critique + synthesis planning,
- bounded review/fix unrolling,
- single-node consult,
- linear relay.

## LangGraph mapping

LangGraph can replace some low-level graph scheduling and state-transition mechanics, but it does not replace Pi-specific team behavior.

| Current code | LangGraph fit | Notes |
|---|---:|---|
| topological node execution | High | LangGraph models nodes/edges and execution state. |
| fanout/join execution | High | Debate fanout and synthesis join map naturally. |
| bounded static unrolling | Medium | Pair review/fix can compile to a finite graph before execution. |
| retry wrappers | Medium | The spike still needed Pi-side retry semantics to preserve no-retry-on-timeout/cancellation behavior. |
| timeouts/cancellation | Medium | The spike still needed Pi-side AbortSignal wrappers around node functions. |
| output reduction | Low/Medium | Easy either way; keep Pi-specific reducer for inspectable output. |
| prompt packaging | Low | This is Pi/team-specific and should remain explicit TypeScript. |
| session events | Low | Pi must still write `pi-teams:run` events around node lifecycle. |
| live `agent:<name>` routing | Low | LangGraph can call a node function, but Panopticon/Maildir messaging remains Pi-specific. |

## Branch-only spike

Spike branch: `origin/langgraph-spike`  
Spike commit: `94628e8` (`Spike LangGraph team graph adapter`)

The spike added a focused LangGraph adapter/test fixture rather than production code. It kept current team manifests unchanged and proved that LangGraph can reproduce core graph semantics with Pi-owned wrappers:

- fanout execution with bounded `maxConcurrency`,
- deterministic output reduction,
- skipped dependents after upstream failure,
- bounded retries and runtime retry override precedence,
- no retry after timeout,
- parent cancellation propagation.

Validation on the spike branch:

```bash
npm run check
npm test
# 34 files, 374 tests
```

The focused spike test was 229 lines. Installing LangGraph for the spike changed:

```text
package.json       +5 dev dependencies/peers
package-lock.json  +389 lines
```

Audit comparison:

```text
main:              15 findings  (10 moderate, 2 high, 3 critical)
langgraph-spike:   19 findings  (14 moderate, 2 high, 3 critical)
```

The spike added four moderate audit findings tied to LangGraph packages and shared `uuid` transitives. It did not add new critical findings, but it still increased dependency and audit surface.

## What remains Pi-specific

Even with LangGraph, pi-teams still needs adapters for:

1. Building a node function from a `TeamAgentBinding`.
2. Rendering system/template prompts and upstream outputs.
3. Calling one-shot model children through `runMember()`.
4. Calling live agents through Panopticon/Maildir.
5. Recording bounded session events in `TeamStateManager`.
6. Preserving retry, timeout, cancellation, and skipped-dependent semantics.
7. Formatting `team_run` tool results and `team_describe` inspection output.

LangGraph should not own these concerns; hiding them in opaque callbacks would reduce inspectability. The spike therefore produced zero net reduction in abstraction complexity.

## TypeScript fit

LangGraph's type API narrows node names statically after each builder call. pi-teams uses runtime role names from team manifests. The spike needed a localized structural cast around the graph builder to keep dynamic role names workable.

That cast is not a technical blocker, but it weakens the migration case: a dependency meant to simplify the graph runtime should not also reduce type inference on the core team authoring path.

## Council, navigator, and local audit review

- Council review recommended closing P9 with a do-not-migrate decision: the spike proves feasibility, not necessity.
- Navigator review agreed with the KISS/YAGNI direction and requested stronger wording around abstraction complexity, type inference loss, and audit evidence.
- Local audit agent agreed that LangGraph is viable but unnecessary for the current static lowered graph model.

## Decision

Do not migrate pi-teams to LangGraph now.

The branch-only spike proved LangGraph can reproduce current graph semantics, but it did not satisfy the decision gate. It does not delete enough custom code because the hard parts are Pi-specific adapters and semantics, not generic graph traversal. It also adds framework indirection, dependency/audit surface, and type friction for dynamic role names.

Keep the current in-repo DAG executor. Do not merge the LangGraph dependency or package-lock changes into `main`.

## Revisit only if

Re-open this decision only when a concrete requirement needs LangGraph-specific value, such as:

- durable graph checkpoints beyond current `pi-teams:run` session events,
- human-in-the-loop graph state,
- complex conditional graph execution that would otherwise grow a custom DSL,
- better graph visualization/debug tracing that remains inspectable,
- substantial deletion of Pi-owned scheduling code,
- acceptable dependency/audit posture,
- clean dynamic-role typing without structural casts or broad `unknown` plumbing.
