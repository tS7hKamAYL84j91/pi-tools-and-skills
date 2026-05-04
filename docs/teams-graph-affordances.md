# Teams Graph Affordances

Living plan for extending `extensions/pi-teams` graph topology affordances. Steal design patterns from LangGraph (and others) to make the `graph` protocol a real topology definition language, not just a static DAG that must be pre-unrolled by lowering.

**Amended after council review on 2026-05-04.** Council approved directionally but required 10 amendments before implementation. See the ADR log for details.

## Goal

Make multi-agent topology authoring fully declarative so that:

1. **Stage 1** — The `graph` protocol is expressive enough to define non-trivial topologies from manifests alone (conditional edges, channels, interrupts, subgraphs). Includes a manifest schema compiler and validator.
2. **Stage 2** — Built-in protocols (`debate`, `consult`, `pair-coding`, `telephone`) become pure data manifests, eliminating `team-lowering.ts` and `protocol-contracts.ts` as code. Migration is phased: add declarative compiler alongside existing lowering, migrate one protocol at a time, run old and new in comparison, delete old lowering only after behavioral equivalence.
3. **Stage 3** — A pi skill generates, validates, repairs, and explains new topologies from natural language. Skill is validator-driven, not just generator-driven.

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

**Status:** ✅ All 9 checkboxes PASS (2026-05-04)

**Navigator review:** 2026-05-04 via `team_run id=consult`

**Outcome:** Implementation can proceed on Stage 1 (T-001 through T-007) after UI specs documented.

**Prep work completed:**
- UI specifications documented inline (interrupt marker, conditional skip, approval event schema)
- Shared `status-symbols.ts` module created
- Compliance findings recorded in `docs/teams-graph-affordances-compliance.md`

See `docs/teams-graph-affordances-compliance.md` for detailed findings.

### UI Specifications for New Affordances

Before Stage 1 implementation, these UI specs are defined:

#### GA-003 Interrupt Marker
- **Symbol:** `⏸` (reused from `kanban/watcher.ts` line 191)
- **Text label:** "interrupted"
- **Usage:** Displayed in graph node status when `interruptAfter: true` node completes and graph pauses
- **Render location:** `team-graph.ts` node status output; future overlay display

#### GA-001 Conditional Skip Representation
- **Primary:** Text "(condition not met)" in node's `error` field
- **Status:** `skipped` (same as dependency skip)
- **Optional symbol:** `⇢` only if visual distinction proves necessary in testing
- **Rationale:** Avoids symbol proliferation; text is clear and theme-agnostic

#### GA-003 Inline Approval Event Schema

When a node with `interruptAfter: true` completes:

```typescript
// Follow-up event emitted to orchestrating agent
{
  type: "graph-interrupt",
  graphId: string,
  nodeId: string,
  nodeRole: string,
  nodeOutput: string,
  prompt: "Graph paused after '${nodeRole}'. Approve to continue?",
  actions: [
    { id: "approve", label: "Approve", payload: { approved: true } },
    { id: "reject", label: "Request changes", payload: { approved: false, reason?: string } },
    { id: "abort", label: "Abort graph", payload: { aborted: true } }
  ]
}
```

**Resume behavior:**
- Approve: Graph continues to next level
- Reject: Graph continues (node marked succeeded) but rejection reason passed to downstream via channels
- Abort: Graph cancelled, remaining nodes marked `cancelled`

**Timeout:** Interrupted graphs expire after 24 hours (configurable). Expired graphs marked `cancelled`.

**Persistence:** Interrupt state written to pi session tree under `.pi/team-runs/<graph-id>/interrupt.json`.

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
- `condition` is a structured predicate, not an arbitrary prompt or eval-able string, per ADR-001. Initial operators are deliberately small: equality on structured fields and substring matching on `output`.
- Numeric comparison operators (`gt`, `lt`, `gte`, `lte`) are out of scope for Stage 1 and Stage 2. If scores or loop counters become necessary, add numeric field typing and tests before adding numeric operators.
- Predicate evaluation is deterministic against the upstream node result and declared channels. No model call is used for routing decisions.
- If a predicate references an undeclared channel or unsupported field, validation fails before execution. If an expected declared channel has no runtime value, the predicate evaluates false and the target is marked `skipped` with a missing-field reason.
- Skipped conditional targets are marked `skipped` in `GraphNodeResult` with a reason like `condition not met on edge from X`.
- Existing manifests with no `condition` fields behave identically to today.
- `team_describe` output shows conditional edges with their predicate summary.
- Fitness function: an arch test verifies that all `condition` fields in built-in manifests match the structured predicate schema if present.

**Design sketch:**

```typescript
// team-types.ts — additive target shape
interface TeamGraphCondition {
  field: "status" | "output" | `channels.${string}`;
  op?: "eq" | "neq" | "contains" | "not-contains";
  value: string;
}

// Channel references must point to a declared channel key.
// Channel keys use /^[a-z][a-z0-9_]{0,63}$/ and must not be "status" or "output".

interface TeamGraphEdge {
  from: string;
  to: string;
  condition?: TeamGraphCondition;
}

// team-graph.ts — conditional traversal after a node completes
// An edge with no condition is always traversed (current behavior).
// An edge with a condition is traversed only if the deterministic predicate
// matches the upstream node result and declared channel state.
```

### Compliance findings

- **Non-color meaning:** PASS — conditional skips use `GraphNodeStatus` text (`skipped`) plus an error reason; current status labels are text in `team-graph.ts:14` and output packaging includes `Status:` / `Error:` in `team-graph.ts:198-210`.
- **Narrow width:** PASS — no overlay field is added yet; if `team_describe` or overlay surfaces predicates later, truncate like `team-overlay.ts:147`.
- **Overlay/theme/markers:** PASS — no alternate screen needed; primary representation is text `(condition not met)`, not color or a new marker.
- **Graph as shared primitive:** PASS — current graph executor is protocol-neutral; built-ins lower into graph plans in `team-lowering.ts:77-210`.
- **No external graph framework:** PASS — deterministic predicate evaluation remains in `team-graph.ts`, no dependency.
- **Evidence-gated:** PASS — pair-coding skip-review/fix routing cannot be represented by static `{ from, to }` edges today (`team-types.ts:54-57`).
- **Schema-additive:** PASS — optional `condition` defaults to omitted/current behavior.
- **Current implementation gap:** `TeamGraphEdge` has only `from` and `to` (`team-types.ts:54-57`); `runOneNode` only checks failed upstream dependencies, not edge predicates (`team-graph.ts:290-306`).

### GA-002 — State channels / structured node output

**Observation:** `GraphNodeResult` has a single `output: string` field. Everything a node produces — artifacts, reviews, critiques, structured data — is a blob of text that downstream nodes must parse by role name prefix. LangGraph models state as typed channels with reducers (append, replace, merge). This lets nodes write to named keys and downstream nodes read selectively.

Today, the debate synthesis prompt receives all generation and critique outputs mixed into `upstreamPackage()`, which concatenates them by role. There's no way for a node to produce a structured artifact separate from its prose output, or for a downstream node to read only the "review" channel.

**Desired outcome:** Nodes can write structured output to named channels. Downstream nodes can read from specific channels instead of parsing the full upstream blob by role.

**Candidate acceptance criteria:**

- `GraphNodeResult` gains optional structured channel output. When omitted, the node's output remains a single `output` string (current behavior).
- `TeamGraph` gains an optional `channels` field declaring allowed channel keys, allowed writers, reducer (`concat` or `last-wins`), and output shape validation.
- Channel keys must match `/^[a-z][a-z0-9_]{0,63}$/`; `status` and `output` are reserved and cannot be channel keys.
- The validator rejects writes to undeclared channels, condition references to undeclared channels, duplicate channel keys, reserved channel keys, and declared channels without valid writers/reducers.
- `buildNodePrompt` receives resolved channel state from completed upstream nodes, not just the flat `upstream` array.
- The `concat` reducer joins channel values with `\n`. The `last-wins` reducer keeps only the most recent value.
- Existing manifests with no `channels` behave identically to today.
- Fitness function: arch test verifies that all channel keys in built-in manifests are non-empty strings and all declared writers resolve to graph nodes.

**Design sketch:**

```typescript
// team-types.ts — additive target shape
interface GraphChannelDeclaration {
  key: string;                      // e.g., "artifact", "review", "critique"
  writers: string[];                // role ids allowed to write this channel
  reducer: "concat" | "last-wins";  // how multiple writes merge
  outputShape?: "text" | "json";    // initial validation target; extensible later
}

interface TeamGraph {
  edges: TeamGraphEdge[];
  outputs?: string[];
  reducer?: TeamGraphReducer;
  channels?: GraphChannelDeclaration[];
}

interface GraphNodeResult {
  // ...existing fields
  channels?: Record<string, string>; // only declared keys from allowed writers
}
```

### Compliance findings

- **Non-color meaning:** PASS — channels are prompt/state data, not visual-only status.
- **Narrow width:** PASS — no overlay field is added yet; future channel summaries must truncate like `team-overlay.ts:147`.
- **Overlay/theme/markers:** PASS — no new overlay or marker required for channel state.
- **Graph as shared primitive:** PASS — channels extend `GraphNodeResult` and `TeamGraph`, keeping orchestration protocol-neutral.
- **No external graph framework:** PASS — reducers are limited to `concat` and `last-wins`, implemented in the in-repo executor.
- **Evidence-gated:** PASS — current `upstreamPackage()` concatenates all upstream prose (`team-graph.ts:198-210`), so downstream nodes cannot select structured artifact/review channels.
- **Schema-additive:** PASS — optional channel declarations and writes preserve current `output: string` behavior when omitted.
- **Current implementation gap:** `GraphNodeResult` has only `output: string` (`team-graph.ts:25-38`), `TeamGraph` has no channel declarations (`team-types.ts:59-63`), and `buildNodePrompt` receives only flat upstream/completed arrays (`team-graph.ts:224-231`).

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

### Compliance findings

- **Non-color meaning:** PASS — interrupted state uses text `interrupted` plus `⏸` only as a supplemental marker.
- **Narrow width:** PASS — approval prompt is a follow-up payload; any future overlay row must truncate node output and labels.
- **Overlay, not alternate screen:** PASS — inline follow-up approval event avoids an alternate-screen UI.
- **Theme-aware rendering:** PASS — future overlay marker must route through theme rendering; no rendering change in this issue yet.
- **Consistent markers:** PASS — use `⏸`, already documented in this plan and aligned with existing pi marker conventions.
- **Graph as shared primitive:** PASS — interrupt applies at `TeamAgentBinding`/graph executor level, not protocol-specific lowering.
- **No external graph framework:** PASS — persisted pause/resume is implemented in pi session state, not LangGraph.
- **Evidence-gated:** PASS — current `runTeamGraph` loops through all levels and returns only after completion/cancellation (`team-graph.ts:403-452`), so review-before-fix gates cannot be represented.
- **Schema-additive:** PASS — optional `interruptAfter` defaults to omitted/current behavior.
- **Current implementation gap:** `GraphNodeStatus` lacks `interrupted` (`team-graph.ts:14`), `GraphRunResult` has no run `status` field (`team-graph.ts:41-47`), and `TeamAgentBinding` lacks `interruptAfter` (`team-types.ts:30-42`).

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

### Compliance findings

- **Non-color meaning:** PASS — subteam execution changes data/execution, not color-only status.
- **Narrow width:** PASS — no overlay field is added yet; future subteam labels must truncate like other team overlay text.
- **Overlay/theme/markers:** PASS — no new overlay or marker required for subgraph composition.
- **Graph as shared primitive:** PASS — subteam is a graph node execution mode, keeping parent orchestration protocol-neutral.
- **No external graph framework:** PASS — nested runs use existing `runTeamGraph` mechanics and registry resolution.
- **Evidence-gated:** PASS — current node execution supports only live-agent refs or `runMember` (`team-graph.ts:250-255`), so nested review/validation teams require custom lowering today.
- **Schema-additive:** PASS — optional `subteam` defaults to omitted/current behavior.
- **Current implementation gap:** `TeamAgentBinding` has no `subteam` or contract metadata (`team-types.ts:30-42`); `productionRunNode` has no registry-resolved nested team path (`team-graph.ts:250-267`).

## ADR Log

### ADR-001 — Council review amendments (2026-05-04)

**Status:** Accepted

**Context:** Council reviewed the three-stage plan and approved directionally but required amendments before implementation begins.

**Decisions:**

1. **Manifest schema versioning.** Add explicit `schemaVersion` to team manifests before Stage 2 migration. Existing `schemaVersion: 2` continues; the compiler validates against the declared version.

2. **Compiler and validator are Stage 1 deliverables.** The manifest compiler (Manifest → `TeamSpec` → `GraphValidationResult`) and strict validator are first-class outputs of Stage 1, not incidental implementation details. Both must have integration tests before any Stage 2 work begins.

3. **Protocol mapping audit before Stage 2.** Before deleting `team-lowering.ts`, audit each of the four built-in protocols (debate, consult, pair-coding, telephone) against GA-001–GA-004. Confirm that each protocol can be represented as a declarative manifest. If any protocol requires an affordance not yet implemented (e.g., join/fan-in semantics, loop bounds, error/fallback edges), add that affordance to Stage 1 first.

4. **Phased Stage 2 migration.** Do not delete the old lowering path all at once. Migrate one protocol at a time (start with `consult` — simplest). Run old and new lowering in parallel comparison tests. Add golden topology snapshots (frozen `GraphRunResult` fixtures) for behavioral equivalence. Delete the old lowering path only after all four protocols pass golden comparison.

5. **Protocol contracts survive as declarative metadata.** Do not remove `protocol-contracts.ts` outright. Move its parameter schemas and validation into declarative manifest metadata (`promptContracts` and `modelSlots` fields). The concept of "prompt slots with roles and kinds" must survive even if the TypeScript switch statement is deleted.

6. **Typed state channels with declared reducers.** GA-002 channels must include a declared schema: allowed writers, reducer type, and output shape validation. Free-form `Record<string, string>` is not sufficient. The manifest declares channels; the validator enforces that writers produce keys matching declared channels.

7. **Conditional edges use structured predicates, not arbitrary code.** GA-001 `condition` fields must be structured predicates (e.g., `{field: "status", op: "eq", value: "ok"}` or `{field: "output", contains: "error"}`), not arbitrary prompt strings or eval-able code. This prevents prompt injection through conditional edge evaluation.

8. **Subgraph composition rules.** GA-004 (`subteam`) must include:
   - Input/output contracts — a subteam declares what it accepts and produces.
   - Namespace isolation — subteam state does not leak to parent graph unless explicitly declared.
   - Cycle detection — arch test validates the team dependency graph is acyclic.
   - Recursion is forbidden at first. If needed later, add a `maxDepth` field with a default of 1.

9. **Interrupt semantics are fully specified.** GA-003 (`interruptAfter`) must define:
   - Persisted state — interrupted graphs write state to the pi session tree.
   - Resume payload schema — who may resume, with what payload.
   - Timeout/cancel behavior — an interrupted graph that is never resumed eventually expires.

10. **Topology authoring skill is validator-driven.** The Stage 3 skill must generate, validate, repair, and explain — not just generate. Minimum viable skill includes schema targeting, validation, repair loop, and an audit/explanation summary. A large pattern library can be incremental.

### ADR-002 — Compliance assessment and Navigator review (2026-05-04)

**Status:** Accepted

**Context:** Compliance assessment against TUI Design Guide, pi-mono TUI Philosophy, and pi-teams Architecture Principles.

**Findings:**
- All 9 compliance checkboxes PASS
- 2 checkboxes initially marked PARTIAL/PENDING were corrected after code inspection
- No blocking concerns identified

**Navigator review:** 2026-05-04 via `team_run id=consult`

**Decisions:**
1. **Marker consistency** — Reuse `⏸` from `kanban/watcher.ts` line 191 for GA-003 interrupted state
2. **Conditional skip representation** — Use text "(condition not met)" as primary; `⇢` symbol optional
3. **Inline approval schema** — Document follow-up event structure with approve/reject/abort actions
4. **Shared symbol module** — Create `status-symbols.ts` for consistent symbol usage across pi-teams

**Prep work completed:**
- `docs/teams-graph-affordances-compliance.md` created with detailed findings
- `extensions/pi-teams/status-symbols.ts` created with shared symbol constants
- UI specifications documented in living plan (interrupt marker, conditional skip, approval event schema)
- Kanban board initialized with 10 tasks (T-001 through T-010)

**Outcome:** Stage 1 implementation (T-001 through T-007) approved to proceed.

### ADR-003 — ADR-001 target spec cleanup and Navigator review (2026-05-04)

**Status:** Accepted

**Context:** A follow-up review found internal contradictions between ADR-001 amendments and the earlier candidate sketches: GA-001 still described prompt/string conditions, GA-002 still described free-form channel records, Stage 2 examples still used string conditions, and Stage 3 validation still accepted prompt-string conditions.

**Navigator review:** 2026-05-04 via `team_run id=consult`

**Decisions:**
1. Treat this document as the ADR-001 target spec, not a claim that the current TypeScript implementation already supports the new affordances.
2. Replace prompt/string conditions with structured deterministic predicates.
3. Replace free-form channels with declared channel schemas, writer constraints, reducers, and output shape validation.
4. Add a Known Implementation Gaps table mapping ADR-001 requirements to current code status and tracking issues.
5. Keep implementation pending until Stage 1 compiler/validator work begins.

**Outcome:** Documentation is internally aligned with ADR-001 and current implementation gaps are explicit.

### ADR-004 — Stage 1 manifest compiler/validator slice (2026-05-04)

**Status:** Accepted

**Context:** T-005 implemented the first Stage 1 compiler/validator slice before GA-001 through GA-004 executor changes.

**Navigator review:** 2026-05-04 via `team_run id=consult`

**Decisions:**
1. Treat `extensions/pi-teams/team-manifest.ts` as the first-class manifest validation entrypoint.
2. Validate `schemaVersion: 2`, manifest-level `promptContracts`, manifest-level `modelSlots`, and graph shape during registry load.
3. Surface strict validator failures as registry warnings while preserving existing manifests.
4. Let manifest-declared `modelSlots` drive model slot display before protocol-specific handler fallback.
5. Require negative tests for schema, metadata, and graph validation before completing T-005.

**Outcome:** T-005 passed Navigator review after negative tests were added and `npm run check` plus `npm test` passed.

## Known Implementation Gaps (vs. ADR-001 Target Spec)

| ADR-001 requirement | Current code status | Tracking issue |
| --- | --- | --- |
| Structured conditional predicates and evaluator | `TeamGraphEdge` is only `{ from, to }`; no condition schema validation or predicate evaluator exists in `extensions/pi-teams/team-types.ts` and `extensions/pi-teams/team-graph.ts`. | GA-001 |
| Declared channel schemas and validator | `GraphNodeResult` has only `output: string`; `TeamGraph` has only `edges`, `outputs`, and `reducer`; no channel schema validator exists. | GA-002 |
| Interrupted run status and persisted resume state | `runTeamGraph` returns only final `GraphRunResult`; node statuses do not include an interrupted run status. | GA-003 |
| Subteam execution with contracts and namespace isolation | `productionRunNode` runs only live agents or `runMember`; no registry-resolved `subteam` path exists. | GA-004 |
| Declarative compiler/validator | Initial manifest compiler/validator exists for schema version, prompt contracts, model slots, and graph validation. GA-001/GA-004 schemas and Stage 2 protocol extraction remain pending; `team-lowering.ts` and `protocol-contracts.ts` still contain compatibility lowering and hard-coded prompt contracts. | T-005 done; Stage 1 / Stage 2 pending |

## Implementation Plan

1. **GA-001 conditional edges** — Add a structured `condition` predicate to `TeamGraphEdge`. Update validation and `team-graph.ts` to evaluate predicates deterministically against upstream node status, output, and declared channels. Update describe output and add fitness tests for predicate schema.
2. **GA-002 state channels** — Add declared channel schemas to `TeamGraph` and constrained channel writes to `GraphNodeResult`. Update validation, `upstreamPackage()`, and `buildNodePrompt` to use reduced channel state. Add fitness tests for channel keys, writers, reducers, and output shape.
3. **GA-003 interrupt points** — Add `interruptAfter?: boolean` to `TeamAgentBinding`. Update `runTeamGraph` to persist interrupted state, return partial results with `status: "interrupted"`, emit the approval follow-up payload, and support approve/reject/abort resume behavior with expiry. Add integration test for interrupt/resume cycle.
4. **GA-004 subgraph composition** — Add `subteam?: string` plus input/output contract metadata to `TeamAgentBinding`. Update execution to resolve and run subteams with namespace isolation, return the subgraph result to the parent node, and reject recursive/cyclic subteam graphs. Add acyclic dependency arch test and nested team integration test.

## Validation Plan

- `npm run check` — typecheck, lint, knip, type-coverage pass.
- `npm test` — all existing tests pass plus new tests for each affordance.
- Arch tests in `tests/architecture.test.ts` for manifest schema invariants.
- Integration tests for each affordance: conditional edges, channels, interrupts, subgraphs.
- Manual validation in a pi session with a team manifest exercising each new field.

## Progress Log

- 2026-05-04: Draft created from analysis of `team-types.ts`, `team-graph.ts`, `team-lowering.ts`, LangGraph API patterns, and P9 evaluation findings.
- 2026-05-04: Added Stage 2 (declarative protocol lowering) and Stage 3 (topology authoring skill).
- 2026-05-04: Council review via `default-debate`. Directionally approved with 10 required amendments: schema versioning, compiler/validator as Stage 1 deliverables, protocol mapping audit, phased Stage 2 migration, protocol contracts as declarative metadata, typed state channels, structured predicates for conditional edges, subgraph composition rules, interrupt semantics, validator-driven skill. All 10 amendments incorporated into the ADR log and goal/scope sections.
- 2026-05-04: Compliance assessment completed against TUI Design Guide, pi-mono TUI Philosophy, and pi-teams Architecture Principles. All 9 checkboxes PASS.
- 2026-05-04: Navigator review via `team_run id=consult`. Confirmed corrections, approved Stage 1 implementation to proceed.
- 2026-05-04: Prep work completed:
  - Created `docs/teams-graph-affordances-compliance.md` with detailed findings
  - Created `extensions/pi-teams/status-symbols.ts` shared symbol module
  - Documented UI specifications (interrupt marker `⏸`, conditional skip text, approval event schema)
  - Initialized kanban board with 10 tasks (T-001 through T-010)
- 2026-05-04: ADR-002 recorded: Compliance assessment and Navigator review decisions.
- 2026-05-04: Navigator review via `team_run id=consult` found documentation contradictions with ADR-001. Updated GA-001 to structured deterministic predicates, GA-002 to declared channel schemas, Stage 2 examples to predicate YAML, Stage 3 validation to reject prompt-string conditions, and added Known Implementation Gaps against current code.
- 2026-05-04: ADR-003 recorded: ADR-001 target spec cleanup and Navigator review decisions.
- 2026-05-04: Second Navigator review confirmed the main contradictions were resolved and requested doc clarifications for operator scope, channel-key constraints, condition evaluation errors, explicit evaluator/validator gaps, and tracking the existing knip failure. Added those clarifications and opened T-011 for the unused `extensions/pi-teams/status-symbols.ts` module.
- 2026-05-04: T-005 manifest compiler/validator slice implemented: added `validateTeamManifest`, registry parsing for manifest-level `promptContracts` and `modelSlots`, model slot display from manifests, and negative tests for schema, metadata, and graph validation. Initial Navigator review requested broader negative tests; follow-up review returned PASS. Validation: `npm run check`, `npm test`.

**Next:** Continue Stage 1 with T-001 through T-004 (GA affordances), then T-006 and T-007 (tests).

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
  channels:
    - key: review_status
      writers: [navigator_review_1]
      reducer: last-wins
      outputShape: text
  edges:
    - from: driver_implementation
      to: navigator_review_1
    - from: navigator_review_1
      to: driver_fix_1
      condition:
        field: channels.review_status
        op: eq
        value: changes_requested
    - from: navigator_review_1
      to: _end
      condition:
        field: channels.review_status
        op: eq
        value: approved
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
- Condition syntax (if used) validates against the structured predicate schema from ADR-001; prompt strings are rejected.
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