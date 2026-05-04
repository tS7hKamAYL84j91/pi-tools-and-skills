# Teams Simplification: Clean Protocol Interface, Direct Topologies

Living plan for replacing the generic DAG executor in `extensions/pi-teams` with a clean protocol interface backed by direct topology implementations. The `TeamHandler` interface is the architecture boundary; the DAG is an unnecessary implementation detail *behind* it.

Inspired by the F.I.R.E. architecture review (`docs/fire-architecture-review.md`): *"If topologies are mostly static (like debate or pair-coding), strongly consider replacing the DAG engine with explicit, direct coordination functions."*

## Goal

Apply clean architecture: a stable `TeamHandler` protocol interface at the boundary, with simple direct implementations behind it. Delete the generic DAG graph executor — it adds complexity without adding capability for the topologies we actually have.

The contract is `TeamHandler`:

```typescript
interface TeamHandler {
  key: string;                              // protocol identity
  matches(team: TeamSpec): boolean;         // can this handler run this team?
  modelSlots(team, models): TeamModelSlot[]; // what model choices does the user get?
  run(args: TeamHandlerRunArgs): Promise<TeamHandlerResult>; // execute the topology
}
```

Everything behind `run()` is an implementation detail. Today that detail is 1,204 lines of generic DAG machinery. It should be ~200 lines of direct topology functions.

## FIRE Argument

The generic DAG executor violates F.I.R.E. "Restrained" in three ways:

1. **Cognitive overhead** — `team-graph.ts` (452 lines) implements topological sort, level execution, graph validation, conditional edge evaluation, state channels, and retry/timeout/cancellation. For **4 fixed topologies**, this is a framework in search of a problem.
2. **Lowering indirection** — `team-lowering.ts` (336 lines) compiles protocol names into graph plans. Each protocol's lowering function creates bindings, edges, and prompt builders — exactly what a direct implementation would do, but forced through a generic graph API.
3. **Schema complexity** — `TeamGraphEdge`, `TeamGraph`, `GraphNodeResult`, `GraphNodeStatus`, `GraphValidationResult` — 6 graph-specific types in `team-types.ts`. None of these are needed if each topology is a function.

The four real topologies are trivially simple when implemented directly:

| Protocol | Shape | DAG benefit? |
|---|---|---|
| `consult` | 1 node | No — just `runMember()` |
| `telephone` | Linear chain | No — just `for...of` |
| `debate` | Fanout + join | Minimal — `Promise.all()` twice |
| `pair-coding` | Linear with bounded retry | No — just `for` loop with break |

## Scope

In scope:

- Replace `graphHandler` and `loweredGraphHandler` with two direct protocol handlers:
  - `councilHandler` — unifies `consult` (1 navigator) and `debate` (N members + critics + synthesis).
  - `pairCodingHandler` — direct implementation of navigator brief → driver implementation → review/fix loop.
- Delete `team-graph.ts`, `team-lowering.ts`, `protocol-contracts.ts`, and related graph types.
- Simplify `team-types.ts` by removing `TeamGraph`, `TeamGraphEdge`, `GraphNodeResult`, `GraphValidationResult`, etc.
- Keep the `TeamHandler` interface as the clean extension point for future topologies.
- Keep `live-agent.ts` and `runner.ts` (node execution primitives).
- Keep prompt resolution and template rendering.

Out of scope:

- Changing the `team_run` tool interface or `team_form` command.
- Changing the `/teams` overlay or picker UI.
- Any new topologies beyond council and pair-coding.
- Backward compatibility for `protocol: "graph"` user-defined graphs (they don't exist in the wild yet).

## Constraints

- KISS/F.I.R.E.: each topology is a plain async function. No framework, no generic engine.
- Follow `docs/fire-architecture-review.md` recommendation 1: *"Define a minimal contract for the DAG executor. If topologies are mostly static, strongly consider replacing the DAG engine with explicit, direct coordination functions."*
- The `TeamHandler` interface is the clean boundary. New topologies plug in by implementing `matches()`, `modelSlots()`, and `run()`.
- No new dependencies.
- Review non-trivial design choices with co-pilot.

## Compliance Assessment

### FIRE Principles

- [ ] **Fast** — direct functions are faster to compile, execute, and understand than generic graph traversal.
- [ ] **Inexpensive** — deleting ~1,200 lines costs nothing; maintaining ~1,200 lines costs attention.
- [ ] **Restrained** — no generic engine means no temptation to add conditional edges, state channels, or subgraph composition before they're needed.
- [ ] **Elegant** — `runCouncil()` and `runPairCoding()` are self-explanatory; `runTeamGraph()` is not.

### pi-teams Architecture Principles

- [ ] **Handler interface preserved** — `TeamHandler` remains the extension point.
- [ ] **Prompt resolution unchanged** — protocol prompt slots still resolve with the same precedence chain.
- [ ] **Live-agent support preserved** — `runLiveAgentNode()` still works for `agent:<name>` bindings.
- [ ] **Session events preserved** — `TeamStateManager.recordNodeCompleted()` still records per-node results.
- [ ] **No `protocol: "graph"` requirement** — user-defined graphs don't exist yet, so removing them is not a regression.

### How to run the assessment

1. Read `team-handlers.ts`, `team-graph.ts`, `team-lowering.ts`, `runner.ts`, and `live-agent.ts`.
2. Check every checkbox above.
3. Record **pass** or **fail + specific line/behavior** in a finding under the relevant issue.

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
| TS-001 implement `councilHandler` | Direct council handler for `council`/`consult`/`debate` | Implemented | `npm run check`, `npm test` | Done |
| TS-002 implement `pairCodingHandler` | Direct pair-coding loop with review-gated fixes | Implemented | `npm run check`, `npm test` | Done |
| TS-003 delete DAG executor and lowering | Remove graph executor/lowering/contracts | Implemented | Arch test forbids removed imports; Knip clean | Done |
| TS-004 simplify `team-types.ts` | Remove graph schema fields and dependency policy | Implemented | Typecheck/registry tests | Done |
| TS-005 migrate prompt contracts into handlers | Handler-local prompt slot declarations | Implemented | Prompt-chain tests | Done |
| TS-006 update `docs/teams-graph-affordances.md` | Supersede graph affordances plan | Implemented | Documentation grep clean | Done |

## Issues

### TS-001 — Implement `councilHandler` (replaces consult + graph debate)

**Observation:** The `consult` protocol is a single Navigator call. The `debate` protocol is a multi-model council: N members generate in parallel, N critics review their output, a synthesizer merges everything. Today both go through `graphPlanFor*` lowering → `runTeamGraph`. But the council is just:

```
1. Run all members in parallel → Promise.all()
2. Run all critics in parallel → Promise.all()  
3. Run synthesis → single call
```

That's three sequential steps with two `Promise.all()` calls. No topological sort needed.

**Desired outcome:** A `councilHandler` that directly implements the council topology. It supports both the lightweight consult case (1 member, 0 critics, 1 synthesizer) and the full debate case (N members, N critics, 1 synthesizer). The `protocol` field on the manifest becomes `"council"` (renaming both `consult` and `debate` into one unified handler).

**Candidate acceptance criteria:**

- `councilHandler.matches()` returns `true` for `protocol: "council"`, `protocol: "consult"`, and `protocol: "debate"` (backward compat).
- `councilHandler.run()` directly orchestrates members → critics → synthesis using `Promise.all()`.
- Prompt resolution uses the same prompt slot system, but slots are resolved inline in the handler, not through `protocol-contracts.ts`.
- Live-agent bindings (`agent:<name>`) work for any council role.
- Session events (`recordNodeCompleted`) are recorded for each node, same as today.
- `modelSlots()` returns member slots + synthesis slot for debate, just navigator for consult.
- Integration test: council with 2 members produces the same output shape as today's debate.
- Net lines: `councilHandler` should be under 120 lines (vs 452 + 336 for graph + lowering today).

### Compliance findings

- **FIRE Fast — fail:** `consult` and `debate` still lower through `graphPlanForSimpleProtocol()` and execute via `runTeamGraph()` (`extensions/pi-teams/team-handlers.ts:168-212`), so direct protocol execution is not implemented.
- **FIRE Inexpensive — fail:** council behavior is split across `loweredGraphHandler`, `graphPlanForDebate()`, `graphPlanForConsult()`, and the generic graph executor (`extensions/pi-teams/team-handlers.ts:168-234`, `extensions/pi-teams/team-lowering.ts:77-185`, `extensions/pi-teams/team-graph.ts:403-452`).
- **FIRE Restrained — fail:** debate creates graph bindings and edges before execution (`extensions/pi-teams/team-lowering.ts:87-115`), retaining the generic DAG abstraction.
- **FIRE Elegant — fail:** no `councilHandler` exists; handler registration includes only `graphHandler` and `loweredGraphHandler` (`extensions/pi-teams/team-handlers.ts:236-239`).
- **Handler interface preserved — pass:** `TeamHandler` remains the boundary with `key`, `matches`, `modelSlots`, and `run` (`extensions/pi-teams/team-handlers.ts:57-62`).
- **Prompt resolution unchanged — fail for target state:** prompt resolution works today, but through centralized `protocol-contracts.ts` and lowering (`extensions/pi-teams/protocol-contracts.ts:26-83`, `extensions/pi-teams/team-lowering.ts:58-60`), not inline in the council handler.
- **Live-agent support preserved — pass current behavior:** graph execution delegates live-agent refs to `runLiveAgentNode()` (`extensions/pi-teams/team-graph.ts:250-253`; implementation at `extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass current behavior:** lowered runs record per-node completions after graph execution (`extensions/pi-teams/team-handlers.ts:213-227`).
- **No `protocol: "graph"` requirement — fail:** explicit graph protocol is still matched and executed (`extensions/pi-teams/team-handlers.ts:124-165`).

### TS-002 — Implement `pairCodingHandler` (replaces pair-coding lowered graph)

**Observation:** Pair-coding is a linear sequence with bounded review/fix retries:

```
1. Navigator brief → 2. Driver implementation → 3. (Navigator review → Driver fix) × maxFixPasses
```

Today this is compiled into a flat graph by `graphPlanForPairCoding`, which unrolls the loop into `navigator_review_1`, `driver_fix_1`, `navigator_review_2`, `driver_fix_2`, etc. That's the worst of both worlds: the loop is hidden in lowering code, and the graph executor sees a flat chain with no loop semantics.

**Desired outcome:** A `pairCodingHandler` that directly implements the pair-coding loop. The review/fix loop is a real `for` loop, not an unrolled graph.

**Candidate acceptance criteria:**

- `pairCodingHandler.matches()` returns `true` for `protocol: "pair-coding"`.
- `pairCodingHandler.run()` directly orchestrates: brief → implementation → for(pass=1..maxFixPasses) { review → fix if changes requested }.
- The Navigator review output determines whether to continue the loop (changes requested) or exit (approved).
- Prompt resolution is inline, not through `protocol-contracts.ts`.
- Live-agent bindings work for driver and navigator roles.
- Session events recorded for each step.
- Integration test: pair-coding with `maxFixPasses=2` produces the same behavior as today.
- Net lines: under 100 lines (vs 452 + 336 for graph + lowering).

### Compliance findings

- **FIRE Fast — fail:** `pair-coding` still lowers to a graph plan, then executes through `runTeamGraph()` (`extensions/pi-teams/team-handlers.ts:168-212`).
- **FIRE Inexpensive — fail:** pair-coding loop semantics are encoded as generated graph nodes (`navigator_review_N`, `driver_fix_N`) in lowering (`extensions/pi-teams/team-lowering.ts:123-160`).
- **FIRE Restrained — fail:** direct bounded retry/fix loop does not exist; current lowering unrolls `maxFixPasses` into a flat chain (`extensions/pi-teams/team-lowering.ts:136-148`).
- **FIRE Elegant — fail:** no `pairCodingHandler` exists; handler registration includes only graph-backed handlers (`extensions/pi-teams/team-handlers.ts:236-239`).
- **Handler interface preserved — pass:** `TeamHandler` remains intact (`extensions/pi-teams/team-handlers.ts:57-62`).
- **Prompt resolution unchanged — fail for target state:** prompt slots resolve through centralized `PROTOCOL_PROMPT_CONTRACTS` (`extensions/pi-teams/protocol-contracts.ts:38-47`) instead of inline handler declarations.
- **Live-agent support preserved — fail against acceptance criteria:** pair-coding currently rejects `agent:` model overrides for driver/navigator (`extensions/pi-teams/team-lowering.ts:51-55`, `extensions/pi-teams/team-lowering.ts:128-131`), while the new acceptance criteria require live-agent bindings for both roles.
- **Session events preserved — pass current behavior:** per-node completion records are emitted after graph execution (`extensions/pi-teams/team-handlers.ts:213-227`).
- **No `protocol: "graph"` requirement — fail:** the graph handler remains registered (`extensions/pi-teams/team-handlers.ts:124-165`, `extensions/pi-teams/team-handlers.ts:236-239`).

### TS-003 — Delete DAG executor and lowering

**Observation:** After TS-001 and TS-002, no protocol uses the DAG executor. `team-graph.ts` and `team-lowering.ts` become dead code. The FIRE review explicitly recommends this: *"Put a hard boundary around pi-teams: strongly consider replacing the DAG engine with explicit, direct coordination functions."*

**Desired outcome:** Delete `team-graph.ts`, `team-lowering.ts`, `protocol-contracts.ts`, and the `graphHandler`/`loweredGraphHandler` from `team-handlers.ts`.

**Candidate acceptance criteria:**

- `team-graph.ts` deleted.
- `team-lowering.ts` deleted.
- `protocol-contracts.ts` deleted.
- `graphHandler` and `loweredGraphHandler` removed from `team-handlers.ts`.
- `TeamGraph`, `TeamGraphEdge`, `GraphValidationResult`, `GraphNodeResult`, `GraphNodeStatus`, `GraphRunResult`, `GraphRunArgs`, `GraphNodePromptBuilder`, and `GraphNodeRunner` types removed from `team-types.ts`.
- All imports of these types throughout `pi-teams` are removed.
- `npm run check` and `npm test` pass.
- Fitness function: arch test confirms no files in `extensions/pi-teams` import from a `team-graph` or `team-lowering` module.
- Knip confirms no dead exports remain.

### Compliance findings

- **FIRE Fast — fail:** `runTeamGraph()` still performs graph validation and level execution (`extensions/pi-teams/team-graph.ts:403-452`).
- **FIRE Inexpensive — fail:** `team-graph.ts`, `team-lowering.ts`, and `protocol-contracts.ts` remain in place and imported (`extensions/pi-teams/team-handlers.ts:9-10`, `extensions/pi-teams/team-lowering.ts:7`, `extensions/pi-teams/team-graph.ts:11`).
- **FIRE Restrained — fail:** graph validation, dependency policy, retry, timeout, and concurrency machinery are still active (`extensions/pi-teams/team-graph.ts:164-195`, `extensions/pi-teams/team-graph.ts:275-367`, `extensions/pi-teams/team-graph.ts:369-400`).
- **FIRE Elegant — fail:** built-in protocols still route through the lowering indirection (`extensions/pi-teams/team-handlers.ts:199-212`).
- **Handler interface preserved — pass:** deleting graph-backed handlers can retain `TeamHandler` unchanged (`extensions/pi-teams/team-handlers.ts:57-62`).
- **Prompt resolution unchanged — pass current behavior:** prompt resolver primitives are independent of the graph (`extensions/pi-teams/prompt-resolver.ts:35-115`); only the centralized protocol contract layer must move.
- **Live-agent support preserved — pass current behavior:** `runLiveAgentNode()` is a reusable primitive outside the graph module (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass current behavior:** state recording currently happens at the handler layer, not inside `team-graph.ts` (`extensions/pi-teams/team-handlers.ts:213-227`).
- **No `protocol: "graph"` requirement — fail:** `graphHandler.matches()` still supports `team.protocol === "graph"` and graph edges (`extensions/pi-teams/team-handlers.ts:124-128`).

### TS-004 — Simplify `team-types.ts`

**Observation:** After TS-003, `TeamSpec.graph` (the `TeamGraph` field) is no longer consumed by any executor. The `TeamAgentBinding.dependencyPolicy` field ("require-ok" | "allow-failed") was only used by the graph executor. The `TeamGraphReducer` type ("concat") was only used by graph output reduction.

**Desired outcome:** Remove graph-specific fields from the schema where they are no longer consumed. Keep fields that are still meaningful for direct handlers (e.g., `maxRetries` on bindings).

**Candidate acceptance criteria:**

- `TeamSpec.graph` field removed from the schema (or made optional with a clear deprecation note if external manifests might still include it).
- `TeamGraphEdge`, `TeamGraph`, `TeamGraphReducer` types removed.
- `TeamAgentBinding.dependencyPolicy` removed (no longer consumed).
- `TeamSpec.prompts` preserved (still used for prompt resolution).
- `TeamSpec.limits` preserved (timeout, maxFixPasses, maxConcurrency still relevant).
- All manifests in `config/teams/` updated to remove graph fields.
- `npm run check` and `npm test` pass.

### Compliance findings

- **FIRE Fast — fail:** graph-specific schema still feeds execution (`TeamSpec.graph` at `extensions/pi-teams/team-types.ts:82-95`; consumed by `extensions/pi-teams/team-graph.ts:90-91`, `extensions/pi-teams/team-graph.ts:178-190`).
- **FIRE Inexpensive — fail:** unused-in-target graph types remain in the core schema (`extensions/pi-teams/team-types.ts:44-45`, `extensions/pi-teams/team-types.ts:71-80`).
- **FIRE Restrained — fail:** `TeamAgentBinding.dependencyPolicy` keeps graph dependency semantics in the general binding shape (`extensions/pi-teams/team-types.ts:30-42`; consumed at `extensions/pi-teams/team-graph.ts:293-295`).
- **FIRE Elegant — fail:** direct protocols still have to carry graph-capable manifest shape via `TeamSpec.graph` (`extensions/pi-teams/team-types.ts:82-95`).
- **Handler interface preserved — pass:** graph type removal does not require changing `TeamHandler` (`extensions/pi-teams/team-handlers.ts:57-62`).
- **Prompt resolution unchanged — pass:** `TeamSpec.prompts` remains in the target schema and currently exists at `extensions/pi-teams/team-types.ts:88`.
- **Live-agent support preserved — pass:** live-agent logic depends on `TeamAgentBinding.subagent`, not graph schema (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** node completion event shape is independent of `TeamSpec.graph` (`extensions/pi-teams/team-handlers.ts:213-227`).
- **No `protocol: "graph"` requirement — fail:** schema still includes `graph?: TeamGraph` (`extensions/pi-teams/team-types.ts:93`) and the graph handler still consumes it (`extensions/pi-teams/team-handlers.ts:124-128`).

### TS-005 — Migrate prompt contracts into handlers

**Observation:** `protocol-contracts.ts` defines prompt slots per protocol as a TypeScript switch (`PROTOCOL_PROMPT_CONTRACTS`). After TS-003 deletes it, each handler must resolve its own prompt chains. The prompt resolution logic (slot → chain → system/template text) stays in `prompt-resolver.ts`, but the declaration of which slots exist moves into the handler code.

**Desired outcome:** Each handler (`councilHandler`, `pairCodingHandler`) declares its own prompt slots inline. No centralized protocol-to-slots mapping.

**Candidate acceptance criteria:**

- `councilHandler` declares prompt slots for: `generation.system`, `critique.system`, `critique.template`, `synthesis.system`, `synthesis.template`, `navigator.system`, `navigator.template`.
- `pairCodingHandler` declares prompt slots for: `navigatorBrief.system`, `driverImplementation.system`, `navigatorReview.system`, `driverFix.system`, and corresponding templates.
- Prompt resolution still uses `resolveSystemPrompt()` and `resolveTemplatePrompt()` from `prompt-resolver.ts`.
- No centralized `PROTOCOL_PROMPT_CONTRACTS` dictionary.
- `npm run check` and `npm test` pass.

### Compliance findings

- **FIRE Fast — fail:** centralized prompt contract lookup runs during graph execution/lowering (`extensions/pi-teams/team-lowering.ts:58-60`, `extensions/pi-teams/team-graph.ts:410-416`).
- **FIRE Inexpensive — fail:** `protocol-contracts.ts` remains a protocol registry to maintain in addition to handlers (`extensions/pi-teams/protocol-contracts.ts:26-55`).
- **FIRE Restrained — fail:** prompt slot knowledge is centralized for protocols that should own their own slots (`extensions/pi-teams/protocol-contracts.ts:26-55`).
- **FIRE Elegant — fail:** prompt slot declarations are separated from the topology code that consumes them (`extensions/pi-teams/team-lowering.ts:77-160`, `extensions/pi-teams/protocol-contracts.ts:26-55`).
- **Handler interface preserved — pass:** moving prompt slot declarations into handlers does not change `TeamHandler` (`extensions/pi-teams/team-handlers.ts:57-62`).
- **Prompt resolution unchanged — pass:** `resolveSystemPrompt()` and `resolveTemplatePrompt()` already provide protocol-agnostic prompt resolution (`extensions/pi-teams/prompt-resolver.ts:44-115`).
- **Live-agent support preserved — pass:** live-agent execution is independent of prompt contract storage (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** session event recording is independent of prompt contract storage (`extensions/pi-teams/team-handlers.ts:213-227`).
- **No `protocol: "graph"` requirement — fail:** `PROTOCOL_PROMPT_CONTRACTS` still contains a `graph` contract (`extensions/pi-teams/protocol-contracts.ts:52-54`).

### TS-006 — Update graph affordances plan

**Observation:** `docs/teams-graph-affordances.md` describes a 3-stage plan to extend the DAG executor. If we delete the DAG executor, that plan is obsoleted. The document should be updated to reflect the new approach (direct topologies) or archived.

**Desired outcome:** Archive `docs/teams-graph-affordances.md` and create a replacement that describes the direct-topology approach. Or update it in place with a clear note that the GA-001 through GA-004 and Stage 2/3 plans are superseded.

**Candidate acceptance criteria:**

- `docs/teams-graph-affordances.md` is either archived or updated with a supersession notice pointing to this document.
- `docs/teams-future-improvements.md` standing decisions are updated: "Keep direct topology functions per protocol; do not reintroduce a generic DAG executor."

### Compliance findings

- **FIRE Fast — fail:** `docs/teams-graph-affordances.md` still describes staged graph-executor improvements instead of direct topologies.
- **FIRE Inexpensive — fail:** retaining the graph affordances plan would keep future maintenance pressure on a component targeted for deletion.
- **FIRE Restrained — fail:** the graph affordances plan encourages Stage 2/3 DAG features that this simplification explicitly rejects.
- **FIRE Elegant — fail:** documentation currently points in two architectural directions: direct topology simplification here and graph expansion in `docs/teams-graph-affordances.md`.
- **Handler interface preserved — pass:** doc update only; no code boundary impact.
- **Prompt resolution unchanged — pass:** doc update only.
- **Live-agent support preserved — pass:** doc update only.
- **Session events preserved — pass:** doc update only.
- **No `protocol: "graph"` requirement — fail:** the graph affordances plan still treats graph teams as a supported future surface.

## ADR Log

- 2026-05-04: Navigator reviewed compliance findings and confirmed they were accurate, with three scope cautions: resolve pair-coding live-agent policy, choose runtime simplification over API-only simplification, and define a schema strategy for legacy graph fields.
- 2026-05-04: Decision: perform runtime simplification, not API-only cleanup. Removed the generic graph executor, lowering layer, centralized protocol contracts, `TeamSpec.graph`, and binding `dependencyPolicy`.
- 2026-05-04: Decision: keep `TeamHandler` as the extension boundary and support direct handlers for council (`consult`/`debate`/`council`), pair-coding, and telephone so existing generated protocol vocabulary remains runnable.
- 2026-05-04: Navigator reviewed implemented changes and found no concrete blocker after confirming `docs/teams-graph-affordances.md` was superseded and grep-clean for removed graph module names.
- 2026-05-04: Refactor decision: extract shared node execution into `team-node-runner.ts` to keep `team-handlers.ts` under architecture file-size limits while preserving behavior.
- 2026-05-04: Navigator reviewed the refactor and found no showstopper; added a follow-up direct unit test for `team-node-runner` pure helpers and superseded the graph-affordances compliance note.

## Implementation Plan

1. **TS-001 `councilHandler`** — Write `councilHandler` implementing `matches`, `modelSlots`, and `run` for the council topology (consult + debate). Inline prompt resolution. Add integration tests. Register in handler list.
2. **TS-002 `pairCodingHandler`** — Write `pairCodingHandler` implementing `matches`, `modelSlots`, and `run` for the pair-coding topology with a real review/fix loop. Inline prompt resolution. Add integration tests. Register in handler list.
3. **TS-003 delete DAG** — Remove `team-graph.ts`, `team-lowering.ts`, `protocol-contracts.ts`. Remove `graphHandler` and `loweredGraphHandler` from `team-handlers.ts`. Add arch test.
4. **TS-004 simplify types** — Remove graph fields from `TeamSpec`, remove graph types, update manifests.
5. **TS-005 migrate prompt contracts** — Move prompt slot declarations into handlers. Remove `protocol-contracts.ts` if not already deleted in TS-003.
6. **TS-006 update docs** — Archive or update graph affordances plan. Update standing decisions.

## Validation Plan

- `npm run check` — typecheck, lint, knip, type-coverage pass.
- `npm test` — all existing tests pass plus new handler integration tests.
- Arch tests: no `team-graph` or `team-lowering` imports in `pi-teams`.
- Behavioral equivalence: council output matches debate output for same inputs. Pair-coding output matches for same inputs.
- Manual validation: `team_run` with each protocol from a pi session.

## Progress Log

- 2026-05-04: Draft created from F.I.R.E. architecture review and analysis of `team-graph.ts`, `team-lowering.ts`, `team-handlers.ts`.
- 2026-05-04: Compliance findings appended under TS-001 through TS-006 with exact code references; Navigator reviewed and confirmed the findings, requesting runtime simplification and explicit legacy schema strategy.
- 2026-05-04: Implemented direct handlers, removed the generic DAG executor/lowering/contracts, simplified team schema, updated registry/form/describe flows, and added architecture coverage to prevent re-importing removed modules. Validation: `npm run check` and `npm test` green.
- 2026-05-04: Superseded `docs/teams-graph-affordances.md`, updated `docs/teams-future-improvements.md` architecture/standing decisions, and superseded `docs/teams-graph-affordances-compliance.md`.
- 2026-05-04: Refactor pass extracted `team-node-runner.ts`, added focused helper tests, confirmed Knip zero findings, architecture tests green, and full validation green.