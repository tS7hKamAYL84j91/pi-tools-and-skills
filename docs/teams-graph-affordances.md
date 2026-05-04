# Teams Graph Affordances

Living plan for extending `extensions/pi-teams` graph topology affordances. Steal design patterns from LangGraph (and others) to make the `graph` protocol a real topology definition language, not just a static DAG that must be pre-unrolled by lowering.

## Goal

Make multi-agent topology authoring fully declarative so that:

1. **Stage 1** — The `graph` protocol is expressive enough to define non-trivial topologies from manifests alone (conditional edges, channels, interrupts, subgraphs).
2. **Stage 2** — Built-in protocols (`debate`, `consult`, `pair-coding`, `telephone`) become pure data manifests, eliminating `team-lowering.ts` and `protocol-contracts.ts` as code.
3. **Stage 3** — A pi skill can generate new topologies from natural language, producing manifests and prompt templates that the agent can immediately `team_run`.

## Scope

In scope:

- `TeamGraphEdge`, `TeamGraph`, `TeamAgentBinding` schema in `team-types.ts`.
- `team-graph.ts` executor (topological levels, node execution, retry/timeout/cancellation, state).
- `team-lowering.ts` and `protocol-contracts.ts` (reduce their burden by moving affordances into the graph layer).
- `GraphNodeResult`, `GraphRunResult` public types.
- Prompt contracts and template resolution for new node-level affordances.
- Headless validation with `npm run check` and `npm test`.

Out of scope:

- LangGraph dependency or any new npm package.
- Changing team manifest schema version (must be additive, v2-compatible).
- Backward compatibility for old protocol formats.
- UI/overlay changes (covered by `docs/teams-ux-improvements.md`).
- Broad protocol extraction or framework migration.

## Constraints

- KISS/YAGNI: add affordances that compose from existing primitives; do not add a runtime expression evaluator or plugin system.
- Each new affordance must have a corresponding fitness function (arch test) and at least one integration test before merge.
- Follow the standing decision: keep the in-repo DAG executor. These affordances extend it; they do not replace it.
- Review non-trivial design choices with co-pilot; use council only if the change affects manifest schema or tool semantics.

## Compliance Assessment

Before changing any schema or executor, assess the current state against these references and record findings inline:

### TUI Design Guide (Toby)

Source: <https://gist.github.com/toby/bf1325449585be869a6b01a03d4cac44> (distilled into `skills/tui-design/SKILL.md`)

Not directly applicable — this work is schema and executor changes, not TUI rendering. However, any new manifest fields that surface in the `/teams` overlay must still satisfy:

- [ ] **Non-color meaning** — new status or state indicators rely on symbols/labels, not color alone.
- [ ] **Narrow width** — new manifest fields that appear in the overlay truncate gracefully.

### pi-mono TUI Philosophy

Source: <https://mariozechner.at/posts/2025-11-30-pi-coding-agent/#toc_6> ("TUI" section)

- [ ] **Overlay, not alternate screen** — no new overlays unless the affordance requires interactive input (e.g., interrupt/approval gates).
- [ ] **Theme-aware rendering** — any new status indicators go through `theme.fg()`.
- [ ] **Consistent markers** — new graph state labels follow pi conventions (`>` for selected, `▶` for active, etc.).

### pi-teams Architecture Principles

From standing decisions in `docs/teams-future-improvements.md` and the P9 LangGraph evaluation:

- [ ] **Graph as shared primitive** — built-in protocols lower into graph plans, but orchestration code stays protocol-neutral where practical.
- [ ] **No external graph framework** — each affordance must be implementable in the existing `team-graph.ts` without adding dependencies.
- [ ] **Evidence-gated** — each affordance must have a concrete user-facing scenario that cannot be represented today.
- [ ] **Schema-additive** — new fields default to omitted; existing manifests and tools continue to work unchanged.

### How to run the assessment

1. Read `team-types.ts`, `team-graph.ts`, `team-lowering.ts`, and `protocol-contracts.ts`.
2. Inspect each proposed affordance against the checkboxes above.
3. Record **pass** or **fail + specific line/behavior** in a finding under the relevant issue.
4. If a checkbox fails, fix it in the same pass or open a new issue.

### Assessment workflow

After recording findings, follow this sequence:

1. **Update Issues** — Append a `### Compliance findings` sub-section under each affected issue with per-checkbox pass/fail results and exact code references. Open new issues for any failures that don't fit existing ones.
2. **Navigator review of findings** — Run `team_run` with `consult` to get the Navigator's assessment of the findings and proposed changes before touching code. Incorporate feedback.
3. **Implement changes** — Make the smallest changes that bring failing checkboxes to pass. Re-run `npm run check` and `npm test` after each change.
4. **Navigator review of changes** — Run `team_run` with `consult` again to review the implemented changes against the original findings. Do not merge until the Navigator confirms all flagged issues are resolved.
5. **Refactor** — Run a cleanup pass per `prompts/refactor.md`. Remove dead code, tighten names, simplify control flow. Run `npm run check` and `npm test`.
6. **Navigator review of refactor** — Run `team_run` with `consult` to confirm the refactor didn't break or regress any fixes.
7. **Final commit and push** — Commit with a descriptive message, push to remote.
8. **Update ADRs and progress log** — After each Navigator review above, update the ADR log with decisions made and add a dated entry to the Progress Log summarizing what was assessed, what changed, and what was reviewed.

## Status

| Issue | Decision | Implementation | Validation | Status |
| --- | --- | --- | --- | --- |
| GA-001 conditional edges | — | — | — | Draft |
| GA-002 state channels | — | — | — | Draft |
| GA-003 interrupt points | — | — | — | Draft |
| GA-004 subgraph composition | — | — | — | Draft |

## Issues

### GA-001 — Conditional edges / dynamic routing

**Observation:** `TeamGraphEdge` is a static `{ from, to }` pair. Every edge is always traversed for the `from` node's downstream, regardless of output content. LangGraph models conditional edges: a function inspects the state flowing out of a node and decides which downstream nodes to activate. This lets you express "route to reviewer only if the output has errors" without unrolling every path statically in the lowering.

Today, the debate protocol works around this by always running every critic (with `allow-failed`), and pair-coding unrolls a fixed number of review/fix passes. But neither pattern can express "skip this edge based on the upstream node's output."

**Desired outcome:** A node can mark certain downstream edges as conditional, evaluated against the upstream node's result. If the condition is not met, the edge is not traversed and the target node is skipped (or replaced by a default fallback).

**Candidate acceptance criteria:**

- `TeamGraphEdge` gains an optional `condition` field. When omitted, the edge is unconditional (current behavior).
- Condition resolution is prompt-based: the edge's `condition` is a short prompt evaluated against the upstream node's output. If the evaluation returns "yes" (or matches a truthy pattern), the edge is traversed; otherwise, it is skipped.
- Skipped conditional targets are marked `skipped` in `GraphNodeResult` with a reason like `condition not met on edge from X`.
- Existing manifests with no `condition` fields behave identically to today.
- `team_describe` output shows conditional edges with their condition text.
- Fitness function: an arch test verifies that all `condition` fields in built-in manifests are non-empty strings if present.

**Design sketch:**

```typescript
// team-types.ts — additive change
interface TeamGraphEdge {
  from: string;
  to: string;
  condition?: string; // prompt evaluated against upstream output; truthy = traverse
}

// team-graph.ts — conditional traversal in runOneNode
// After a node succeeds, evaluate its outgoing edge conditions.
// An edge with no condition is always traversed (current behavior).
// An edge with a condition is traversed only if the condition evaluates truthy
// against the node's output (using a lightweight model call or rule match).
```

### GA-002 — State channels / structured node output

**Observation:** `GraphNodeResult` has a single `output: string` field. Everything a node produces — artifacts, reviews, critiques, structured data — is a blob of text that downstream nodes must parse by role name prefix. LangGraph models state as typed channels with reducers (append, replace, merge). This lets nodes write to named keys and downstream nodes read selectively.

Today, the debate synthesis prompt receives all generation and critique outputs mixed into `upstreamPackage()`, which concatenates them by role. There's no way for a node to produce a structured artifact separate from its prose output, or for a downstream node to read only the "review" channel.

**Desired outcome:** Nodes can write structured output to named channels. Downstream nodes can read from specific channels instead of parsing the full upstream blob by role.

**Candidate acceptance criteria:**

- `GraphNodeResult` gains an optional `channels: Record<string, string>` field. When omitted, the node's output remains a single `output` string (current behavior).
- `TeamGraph` gains an optional `channels` field declaring the named channels and their reducers (`concat` or `last-wins`).
- `buildNodePrompt` receives `channels` from completed upstream nodes, not just the flat `upstream` array.
- The `concat` reducer joins channel values with `\n`. The `last-wins` reducer keeps only the most recent value.
- Existing manifests with no `channels` behave identically to today.
- Fitness function: arch test verifies that all channel keys in built-in manifests are non-empty strings.

**Design sketch:**

```typescript
// team-types.ts — additive changes
interface GraphNodeChannel {
  key: string;                      // e.g., "artifact", "review", "critique"
  reducer: "concat" | "last-wins";  // how multiple writes merge
}

interface TeamGraph {
  edges: TeamGraphEdge[];
  outputs?: string[];
  reducer?: TeamGraphReducer;
  channels?: GraphNodeChannel[];     // declared channels; optional
}

interface GraphNodeResult {
  // ...existing fields
  channels?: Record<string, string>; // structured output per channel
}
```

### GA-003 — Interrupt points / human-in-the-loop

**Observation:** Once `runTeamGraph` starts, it runs to completion or cancellation. There is no way to pause execution after a specific node and wait for human approval before continuing. LangGraph models this with `interrupt_before` and `interrupt_after` on any node. This matters for pair-coding (review before fix), debate (human can steer mid-synthesis), and any graph where a safety gate is needed.

**Desired outcome:** A manifest can mark specific nodes as requiring human approval before the graph proceeds past them. When such a node completes, the graph pauses and emits a follow-up event to the orchestrating agent. The graph resumes when the human approves.

**Candidate acceptance criteria:**

- `TeamAgentBinding` gains an optional `interruptAfter: boolean` field. When `true`, the graph pauses after this node completes.
- When paused, `runTeamGraph` returns a partial `GraphRunResult` with `status: "interrupted"` and the interrupted node's result. The orchestrating agent receives a follow-up with the node's output and a prompt for approval.
- Resuming the graph requires calling `team_run` again with the same `id` and an approval signal.
- Existing manifests with no `interruptAfter` behave identically to today.
- The `/teams` overlay shows interrupted nodes with a distinct marker (`⏸` or equivalent).
- Fitness function: arch test verifies that `interruptAfter` fields, if present, are booleans.

**Design sketch:**

```typescript
// team-types.ts — additive change
interface TeamAgentBinding {
  // ...existing fields
  interruptAfter?: boolean; // pause graph after this node, await human approval
}

// team-graph.ts — after runOneNode completes, check interruptAfter
// If true, emit a followUp event and return partial result with status "interrupted"
// Resume requires re-calling team_run with the graph run id and approval
```

### GA-004 — Subgraph composition / nested team runs

**Observation:** A node in a graph can currently be a single model call (`runMember`) or a live agent (`runLiveAgentNode`). There is no way for a node to be itself a team run — i.e., to delegate to a sub-team whose execution follows its own graph. LangGraph models this as subgraphs: a node whose execution is another graph's run.

This matters for composing complex workflows: a "review" node might itself be a debate team, or a "validation" node might be a chain of model checks. Today, this requires writing a custom lowering function or a new protocol.

**Desired outcome:** A node's `subagent` can reference a team id (not just a model or `agent:<name>`). When the graph executor encounters such a node, it runs that team as a sub-graph, with the node's upstream output as the sub-team's prompt.

**Candidate acceptance criteria:**

- `TeamAgentBinding` gains an optional `subteam?: string` field referencing a team id in the registry.
- When `subteam` is present, `runOneNode` resolves the team from the registry, lowers it to a graph plan, and executes it. The sub-graph's final output becomes the node's output.
- Nested subgraphs must not create cycles (arch test validates the team registry is acyclic).
- The parent graph receives the subgraph's `GraphRunResult` (not just the output string) so it can inspect individual node results.
- Existing manifests with no `subteam` behave identically to today.
- `team_describe` shows subteam references inline.
- Fitness function: arch test verifies that the team dependency graph is acyclic (no team references itself, directly or transitively, through subteam fields).

**Design sketch:**

```typescript
// team-types.ts — additive change
interface TeamAgentBinding {
  // ...existing fields
  subteam?: string; // team id to run as this node's execution
}

// team-graph.ts — in productionRunNode, check for subteam
// If present, load the team from registry, lower to graph plan, and run
// Return the subgraph's final output as this node's output
```

## ADR Log

_No ADRs yet — log decisions here after review._

## Implementation Plan

1. **GA-001 conditional edges** — Add `condition?: string` to `TeamGraphEdge`. Update `team-graph.ts` to evaluate conditions against upstream output (lightweight model call or rule match). Update `team-lowering.ts` and `protocol-contracts.ts` if any built-in protocols want conditional edges. Add fitness function for manifest validation.
2. **GA-002 state channels** — Add `channels?: Record<string, string>` to `GraphNodeResult` and `channels?: GraphNodeChannel[]` to `TeamGraph`. Update `upstreamPackage()` to channel-aware format. Update `buildNodePrompt` signature to receive channels. Add fitness function for manifest validation.
3. **GA-003 interrupt points** — Add `interruptAfter?: boolean` to `TeamAgentBinding`. Update `runTeamGraph` to pause and return partial result on interrupt. Wire follow-up emission to the pi session event system. Update overlay to show interrupted state. Add integration test for interrupt/resume cycle.
4. **GA-004 subgraph composition** — Add `subteam?: string` to `TeamAgentBinding`. Update `productionRunNode` to detect subteam references and recursively execute. Add acyclic dependency arch test. Add integration test for nested team execution.

## Validation Plan

- `npm run check` — typecheck, lint, knip, type-coverage pass.
- `npm test` — all existing tests pass plus new tests for each affordance.
- Arch tests in `tests/architecture.test.ts` for manifest schema invariants.
- Integration tests for each affordance: conditional edges, channels, interrupts, subgraphs.
- Manual validation in a pi session with a team manifest exercising each new field.

## Progress Log

- 2026-05-04: Draft created from analysis of `team-types.ts`, `team-graph.ts`, `team-lowering.ts`, LangGraph API patterns, and P9 evaluation findings.

---

## Stage 2 — Declarative Protocol Lowering

**Prerequisite:** Stage 1 (GA-001 through GA-004) is complete.

### Problem

Today, adding a new topology requires writing TypeScript in two files:

| File | What you write | Lines per protocol |
|---|---|---|
| `protocol-contracts.ts` | Prompt slot declarations | ~10-30 |
| `team-lowering.ts` | `graphPlanFor*` function compiling protocol → graph | ~50-100 |
| `team-handlers.ts` | Handler entry for `loweredGraphHandler.matches` + `modelSlots` | ~20-30 |
| `config/prompts/*.md` | System prompts and templates per role | ~30-50 |
| `config/teams/*.md` | Default team manifest | ~15 |

That's ~1,280 lines of TypeScript across 5 files just to support 4 protocols. Each new protocol requires the same pattern: declare prompt slots, write a lowering function, register a handler, write prompts, write a manifest. An agent (or human) cannot author a new topology without writing TypeScript.

### Goal

Built-in protocols (`debate`, `consult`, `pair-coding`, `telephone`) become pure data — manifests with edges, prompt slot bindings, and model slot mappings declared entirely in YAML frontmatter. `team-lowering.ts` shrinks to zero. `protocol-contracts.ts` becomes unnecessary because the `graph` protocol self-sufficiently handles everything.

### Design

#### 2.1 Manifest-level prompt contracts

Move prompt slot declarations from `protocol-contracts.ts` into the team manifest:

```yaml
# In a team manifest (e.g., default-debate.md)
prompts:
  generation.system: "debate/generation/system"
  critique.system: "debate/critique/system"
  synthesis.system: "debate/synthesis/system"
  critique.template: "debate/critique/template"
  synthesis.template: "debate/synthesis/template"
promptContracts:
  generation.system:
    kind: system
    roles: [member]
  critique.system:
    kind: system
    roles: [critic]
  synthesis.system:
    kind: system
    roles: [synthesis]
  critique.template:
    kind: template
    roles: [critic]
  synthesis.template:
    kind: template
    roles: [synthesis]
```

Resolution precedence remains: protocol default < subagent prompt < team prompt override < binding override < binding literal. The `promptContracts` section is the manifest-level equivalent of `PROTOCOL_PROMPT_CONTRACTS`.

#### 2.2 Manifest-level graph plans

The four built-in protocols each compile to a specific graph structure. Today `team-lowering.ts` does this in TypeScript. Instead, define the graph structure directly in the manifest:

```yaml
# debate.md — expressed as a manifest graph, not lowering code
protocol: "graph"
graph:
  edges:
    - from: generation_1
      to: critique_1
    - from: generation_1
      to: critique_2
    # ... fanout from each generation to each critique
    - from: critique_1
      to: synthesis
    - from: critique_2
      to: synthesis
  outputs: [synthesis]
```

With GA-001 (conditional edges) and GA-002 (channels), this becomes even more expressive:

```yaml
  edges:
    - from: driver_implementation
      to: navigator_review_1
    - from: navigator_review_1
      to: driver_fix_1
      condition: "review requests changes"
    - from: navigator_review_1
      to: _end
      condition: "review approves with no changes"
```

#### 2.3 Manifest-level model slot mappings

Today, `team-handlers.ts` has protocol-specific `modelSlots` functions. Move these into the manifest:

```yaml
modelSlots:
  - id: members
    kind: members
    count: dynamic  # matches number of member bindings
  - id: synthesis
    kind: synthesis
```

The `kind` field maps to the existing slot semantics. The `team_run` tool reads these from the manifest instead of a TypeScript switch.

#### 2.4 Elimination of `team-lowering.ts`

Once built-in protocols are pure manifests:

1. `team-lowering.ts` becomes empty. Delete it.
2. `protocol-contracts.ts` becomes empty. Delete it.
3. `team-handlers.ts` loses `loweredGraphHandler`. The `graphHandler` already works for manifests with `protocol: "graph"`.
4. The `protocol` field on `TeamSpec` transitions from a TypeScript dispatch key to a manifest label. Existing `debate`, `consult`, etc. still work — their manifests now contain the full graph definition.
5. The `graphPlanForSimpleProtocol` function disappears entirely.

#### 2.5 Backward compatibility

- Existing manifests that use `protocol: "debate"` continue to work if a matching built-in manifest ships with the extension. The handler dispatch checks for graph edges first; only falls back to lowering code if no graph is defined.
- During migration (2.4), both paths coexist: manifests with graph edges use `graphHandler`; manifests without edges and a known protocol use `loweredGraphHandler`.
- Once all four built-in protocols ship as graph manifests, the lowering path is removed.

### Acceptance Criteria

- [ ] All four built-in protocols (`debate`, `consult`, `pair-coding`, `telephone`) have manifest-only equivalents in `config/teams/` that produce identical graph plans.
- [ ] Integration tests pass: running each protocol via lowering produces the same `GraphNodeResult[]` as running the manifest-only version.
- [ ] `team-lowering.ts` and `protocol-contracts.ts` are deleted or reduced to a compatibility shim under 20 lines.
- [ ] `team_run` with `protocol: "graph"` and a manifest containing edges/promptContracts/modelSlots works without any TypeScript lowering.
- [ ] Arch test: graph manifests validate against the `TeamSpec` schema with no `protocol`-specific switch.

---

## Stage 3 — Topology Authoring Skill

**Prerequisite:** Stage 2 is complete. Built-in protocols are pure manifests. `team-lowering.ts` is gone.

### Problem

Even with fully declarative manifests, authoring a new topology requires understanding:
1. The `TeamSpec` schema (edges, bindings, prompt contracts, model slots).
2. Graph validation rules (no cycles, connected DAG, at least one root and one output).
3. Prompt template conventions (`{{prompt}}`, `{{inputs}}`, `{{role}}`).
4. File layout conventions (`.pi/teams/*.md`, `.pi/prompts/teams/**`).
5. The `team_run` and `team_form` tool interface.

A human can learn this from docs. An agent needs a skill.

### Goal

A pi skill (`skills/team-topology-creator/SKILL.md`) that enables any pi agent to author a new team topology from a natural language description, producing valid manifests and prompt templates that can be immediately run with `team_run`.

### Design

#### 3.1 Skill description

```
team-topology-creator

Create or refine pi-teams topology manifests and prompt templates from natural language descriptions.

Use when a user or agent asks to create a new team topology, modify an existing one,
or describe a multi-agent workflow pattern that doesn't match built-in protocols.
```

#### 3.2 Skill contents

The skill file encodes:

1. **Schema reference** — the `TeamSpec` fields, `TeamGraphEdge` schema (including `condition` from GA-001, `channels` from GA-002), and `TeamAgentBinding` schema (including `interruptAfter` from GA-003, `subteam` from GA-004).
2. **Graph validation rules** — no cycles, connected DAG, at least one root and one output, unique role names, model bindings required for every node.
3. **Prompt template conventions** — `{{prompt}}` for the user's original prompt, `{{inputs}}` for upstream output, `{{role}}` and `{{label}}` for the current node's identity, `{{key}}` for named channel data.
4. **File layout** — `.pi/teams/<id>.md` for manifests, `.pi/prompts/teams/<id>/**` for prompt files.
5. **Examples** — the four built-in protocols as reference manifests showing edges, prompt contracts, and model slots.
6. **Authoring workflow** —
   - Parse the user's natural language description into roles, edges, and communication patterns.
   - Generate the manifest YAML frontmatter.
   - Generate stub prompt templates for each role.
   - Validate against `TeamSpec` schema and graph validation rules.
   - Write files to the correct locations.
   - Register with `team_run` and verify with a dry run.

#### 3.3 Validation by the skill

The skill encodes the same validation that `validateTeamGraph` runs:

- Unique role names.
- No self-referencing edges.
- No duplicate edges.
- Connected DAG (every node reachable from a root).
- At least one output node.
- Model bindings present for every node.
- Condition syntax (if used) is a valid prompt string.
- Subteam references (if used) resolve to existing team ids.
- No cycles through subteam references.

The skill runs these checks before writing files, so the agent produces valid manifests on the first attempt.

#### 3.4 Interaction with `team_run` and `team_form`

After the skill writes a manifest and prompts:

1. The agent calls `team_run` with the new team id and a test prompt.
2. If the graph validation fails, the error message tells the agent exactly what's wrong — the skill can self-correct.
3. If the graph runs, the agent inspects the output and can iterate on prompt templates.

### Acceptance Criteria

- [ ] The skill file exists at `skills/team-topology-creator/SKILL.md` and includes schema reference, validation rules, file layout, examples, and authoring workflow.
- [ ] An agent following the skill can create a valid 3-node linear chain topology from a natural language description (e.g., "I want a team where a drafter writes, a reviewer critiques, and a reviser improves").
- [ ] An agent following the skill can create a valid debate topology (2 members + critic + synthesizer) from a description.
- [ ] All generated manifests pass `validateTeamGraph`.
- [ ] The skill does not reference `team-lowering.ts` or `protocol-contracts.ts` (those are deleted in Stage 2).
- [ ] The skill references only manifest-level constructs: `protocol: "graph"`, edges, prompt contracts, model slots, and prompt templates.