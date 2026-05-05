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

- [x] **Fast** — direct functions are faster to compile, execute, and understand than generic graph traversal.
- [x] **Inexpensive** — deleting ~1,200 lines costs nothing; maintaining ~1,200 lines costs attention.
- [x] **Restrained** — no generic engine means no temptation to add conditional edges, state channels, or subgraph composition before they're needed.
- [x] **Elegant** — `runCouncil()` and `runPairCoding()` are self-explanatory; `runTeamGraph()` is not.

### pi-teams Architecture Principles

- [x] **Handler interface preserved** — `TeamHandler` remains the extension point.
- [x] **Prompt resolution unchanged** — protocol prompt slots still resolve with the same precedence chain.
- [x] **Live-agent support preserved** — `runLiveAgentNode()` still works for `agent:<name>` bindings.
- [x] **Session events preserved** — `TeamStateManager.recordNodeCompleted()` still records per-node results.
- [x] **No `protocol: "graph"` requirement** — user-defined graphs don't exist yet, so removing them is not a regression.

### How to run the assessment

1. Read `team-handlers.ts`, `runner.ts`, `live-agent.ts`, and verify `team-graph.ts`/`team-lowering.ts`/`protocol-contracts.ts` are absent.
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

- **FIRE Fast — pass:** `councilHandler` dispatches `consult` directly to `runConsult()` and `debate`/`council` to `runDebate()` without graph traversal (`extensions/pi-teams/team-handlers.ts:217-235`).
- **FIRE Inexpensive — pass:** council behavior is localized to `runConsult()`/`runDebate()` plus shared node helpers (`extensions/pi-teams/team-handlers.ts:238-297`, `extensions/pi-teams/team-node-runner.ts:48-107`).
- **FIRE Restrained — pass:** debate uses two `Promise.all()` fanouts and one synthesis call, not bindings/edges/lowering (`extensions/pi-teams/team-handlers.ts:276-293`).
- **FIRE Elegant — pass:** handler registration names `councilHandler` directly and no graph-backed handler is registered (`extensions/pi-teams/team-handlers.ts:402-406`).
- **Handler interface preserved — pass:** `TeamHandler` remains the boundary with `key`, `matches`, `modelSlots`, and `run` (`extensions/pi-teams/team-handlers.ts:64-69`).
- **Prompt resolution unchanged — pass:** council prompt slots are declared inline and still resolve through `resolveSystemPrompt()`/`resolveTemplatePrompt()` (`extensions/pi-teams/team-handlers.ts:170-183`, `extensions/pi-teams/team-handlers.ts:153-161`).
- **Live-agent support preserved — pass:** council nodes delegate through `runTeamNode()`, which calls `runLiveAgentNode()` for `agent:<name>` bindings (`extensions/pi-teams/team-node-runner.ts:84-95`, `extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** every council node is recorded via `recordNode()` and `TeamStateManager.recordNodeCompleted()` (`extensions/pi-teams/team-handlers.ts:100-111`, `extensions/pi-teams/team-handlers.ts:259`, `extensions/pi-teams/team-handlers.ts:282-294`).
- **No `protocol: "graph"` requirement — pass:** `councilHandler.matches()` accepts only `council`, `consult`, and `debate` (`extensions/pi-teams/team-handlers.ts:219-221`).

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

- **FIRE Fast — pass:** `pairCodingHandler` matches `pair-coding` and runs the topology directly (`extensions/pi-teams/team-handlers.ts:306-350`).
- **FIRE Inexpensive — pass:** loop state is plain local variables plus one bounded `for` loop, not generated plan nodes (`extensions/pi-teams/team-handlers.ts:331-349`).
- **FIRE Restrained — pass:** review/fix control flow exits on failed review or approval via `changesRequested()` (`extensions/pi-teams/team-handlers.ts:299-304`, `extensions/pi-teams/team-handlers.ts:340-345`).
- **FIRE Elegant — pass:** brief, implementation, review, and fix steps are visible in the handler body (`extensions/pi-teams/team-handlers.ts:333-345`).
- **Handler interface preserved — pass:** `TeamHandler` remains intact (`extensions/pi-teams/team-handlers.ts:64-69`).
- **Prompt resolution unchanged — pass:** pair-coding slots are declared inline and resolved through the shared prompt resolver (`extensions/pi-teams/team-handlers.ts:193-203`, `extensions/pi-teams/team-handlers.ts:153-161`).
- **Live-agent support preserved — pass:** driver and navigator bindings use `modelForBinding()`/`runTeamNode()`, preserving `agent:<name>` support (`extensions/pi-teams/team-handlers.ts:319-324`, `extensions/pi-teams/team-node-runner.ts:20-22`, `extensions/pi-teams/team-node-runner.ts:84-95`).
- **Session events preserved — pass:** each pair-coding step records node completion (`extensions/pi-teams/team-handlers.ts:334-347`).
- **No `protocol: "graph"` requirement — pass:** only `pair-coding` matches this handler (`extensions/pi-teams/team-handlers.ts:307-310`).

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

- **FIRE Fast — pass:** no `runTeamGraph()` implementation remains under `extensions/pi-teams`.
- **FIRE Inexpensive — pass:** `team-graph.ts`, `team-lowering.ts`, and `protocol-contracts.ts` are absent; `team-handlers.ts` imports only direct helpers (`extensions/pi-teams/team-handlers.ts:6-15`).
- **FIRE Restrained — pass:** retry/timeout live in the small role-node primitive rather than a generic dependency engine (`extensions/pi-teams/team-node-runner.ts:48-81`).
- **FIRE Elegant — pass:** registered handlers are direct topology handlers only (`extensions/pi-teams/team-handlers.ts:402-406`).
- **Handler interface preserved — pass:** `TeamHandler` is unchanged as the extension boundary (`extensions/pi-teams/team-handlers.ts:64-69`).
- **Prompt resolution unchanged — pass:** resolver primitives remain independent of execution topology (`extensions/pi-teams/team-handlers.ts:153-161`, `extensions/pi-teams/prompt-resolver.ts`).
- **Live-agent support preserved — pass:** `runLiveAgentNode()` remains a reusable primitive (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** state recording happens at the handler layer through `recordNode()` (`extensions/pi-teams/team-handlers.ts:100-111`).
- **No `protocol: "graph"` requirement — pass:** architecture tests forbid imports from removed graph/lowering/contract modules (`tests/architecture.test.ts:233-238`).

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

- **FIRE Fast — pass:** `TeamSpec` no longer includes `graph`, so graph schema cannot feed execution (`extensions/pi-teams/team-types.ts:68-83`).
- **FIRE Inexpensive — pass:** `TeamGraphEdge`, `TeamGraph`, and reducer/result graph types are absent from `team-types.ts` (`extensions/pi-teams/team-types.ts:1-95`).
- **FIRE Restrained — pass:** `TeamAgentBinding` retains node-relevant execution fields but no dependency policy (`extensions/pi-teams/team-types.ts:30-41`).
- **FIRE Elegant — pass:** direct protocols carry only protocol, prompts, model slots, agents, models, limits, source, and path (`extensions/pi-teams/team-types.ts:68-83`).
- **Handler interface preserved — pass:** schema simplification did not change `TeamHandler` (`extensions/pi-teams/team-handlers.ts:64-69`).
- **Prompt resolution unchanged — pass:** `TeamSpec.prompts` remains preserved (`extensions/pi-teams/team-types.ts:73-76`).
- **Live-agent support preserved — pass:** live-agent logic depends on `TeamAgentBinding.subagent`, not removed schema fields (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** node completion recording is independent of removed schema fields (`extensions/pi-teams/team-handlers.ts:100-111`).
- **No `protocol: "graph"` requirement — pass:** legacy workflow fields are ignored with a warning during registry load, not executed (`extensions/pi-teams/team-registry.ts:243-244`).

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

- **FIRE Fast — pass:** prompt slot lookup is a local handler operation (`extensions/pi-teams/team-handlers.ts:206-214`).
- **FIRE Inexpensive — pass:** `protocol-contracts.ts` is absent; no centralized protocol prompt registry remains.
- **FIRE Restrained — pass:** council, telephone, and pair-coding own their prompt slots next to their topology logic (`extensions/pi-teams/team-handlers.ts:170-203`).
- **FIRE Elegant — pass:** prompt slot declarations and prompt consumption now live in one handler module (`extensions/pi-teams/team-handlers.ts:170-203`, `extensions/pi-teams/team-handlers.ts:238-349`).
- **Handler interface preserved — pass:** handler-local slots do not change `TeamHandler` (`extensions/pi-teams/team-handlers.ts:64-69`).
- **Prompt resolution unchanged — pass:** slots still resolve via `resolveSystemPrompt()` and `resolveTemplatePrompt()` (`extensions/pi-teams/team-handlers.ts:153-161`).
- **Live-agent support preserved — pass:** live-agent execution is independent of prompt slot declaration storage (`extensions/pi-teams/live-agent.ts:173-210`).
- **Session events preserved — pass:** session event recording is independent of prompt slot declaration storage (`extensions/pi-teams/team-handlers.ts:100-111`).
- **No `protocol: "graph"` requirement — pass:** there is no centralized graph prompt contract and no `PROTOCOL_PROMPT_CONTRACTS` dictionary.

### TS-006 — Update graph affordances plan

**Observation:** `docs/teams-graph-affordances.md` describes a 3-stage plan to extend the DAG executor. If we delete the DAG executor, that plan is obsoleted. The document should be updated to reflect the new approach (direct topologies) or archived.

**Desired outcome:** Archive `docs/teams-graph-affordances.md` and create a replacement that describes the direct-topology approach. Or update it in place with a clear note that the GA-001 through GA-004 and Stage 2/3 plans are superseded.

**Candidate acceptance criteria:**

- `docs/teams-graph-affordances.md` is either archived or updated with a supersession notice pointing to this document.
- `docs/teams-future-improvements.md` standing decisions are updated: "Keep direct topology functions per protocol; do not reintroduce a generic DAG executor."

### Compliance findings

- **FIRE Fast — pass:** `docs/teams-graph-affordances.md` now contains only a supersession notice pointing to direct topology handlers.
- **FIRE Inexpensive — pass:** future maintenance is directed to small direct handlers, not an executor expansion plan.
- **FIRE Restrained — pass:** GA-001 through GA-004 and Stage 2/3 expansion are explicitly superseded (`docs/teams-graph-affordances.md`).
- **FIRE Elegant — pass:** `docs/teams-future-improvements.md` and this plan now share one architecture direction.
- **Handler interface preserved — pass:** doc update only; no code boundary impact.
- **Prompt resolution unchanged — pass:** doc update only.
- **Live-agent support preserved — pass:** doc update only.
- **Session events preserved — pass:** doc update only.
- **No `protocol: "graph"` requirement — pass:** standing decisions say not to reintroduce a generic executor unless concrete workflow evidence demands it (`docs/teams-future-improvements.md`).

## ADR Log

- 2026-05-04: Navigator reviewed compliance findings and confirmed they were accurate, with three scope cautions: resolve pair-coding live-agent policy, choose runtime simplification over API-only simplification, and define a schema strategy for legacy graph fields.
- 2026-05-04: Decision: perform runtime simplification, not API-only cleanup. Removed the generic graph executor, lowering layer, centralized protocol contracts, `TeamSpec.graph`, and binding `dependencyPolicy`.
- 2026-05-04: Decision: keep `TeamHandler` as the extension boundary and support direct handlers for council (`consult`/`debate`/`council`), pair-coding, and telephone so existing generated protocol vocabulary remains runnable.
- 2026-05-04: Navigator reviewed implemented changes and found no concrete blocker after confirming `docs/teams-graph-affordances.md` was superseded and grep-clean for removed graph module names.
- 2026-05-04: Refactor decision: extract shared node execution into `team-node-runner.ts` to keep `team-handlers.ts` under architecture file-size limits while preserving behavior.
- 2026-05-04: Navigator reviewed the refactor and found no showstopper; added a follow-up direct unit test for `team-node-runner` pure helpers and superseded the graph-affordances compliance note.
- 2026-05-05: Final validation rerun after wording/doc cleanup: `npm run check` and `npm test` passed; no runtime graph/lowering/contract imports found.

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
- 2026-05-05: Rechecked the implementation against the simplification plan, reran `npm run check` and `npm test` successfully, and confirmed remaining changes are wording/docs cleanup plus deletion of the obsolete graph-node prompt asset.
