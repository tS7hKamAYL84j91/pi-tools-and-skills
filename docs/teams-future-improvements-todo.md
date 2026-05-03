# Teams Future Improvements TODO

This is the remediation plan for moving `extensions/pi-teams` from a working extension into a robust, inspectable teams platform.

Keep moving forward and don't  ask for my feedback until you have completed all of these features as noted. Write your ADRs that you agree with the council as  You progress and you are the project manager and architect so I'll make sure you make for you solve Jules or local agents to do the work and the council and your navigator to review your work and decisions.

you have specs for P1 -> P5 in @docs/teams-p1...

Dont use kanban in this repo.

Do mark of in this document ADRs and progress

KISS, YAGNI: do not implement backward compatibility; only implement new features. Make sure you have removed all instances of the old team from the Code Base; e.g., council pair is a smell, and the types or modules that deal specifically with these needs need to be generalised to handle team apology slots and the prompts they produce. We need their teams to be driven by the configuration settings. Jason and the supporting teams' files provide no context for the code.

For each feature, please commit and push your changes when you have them, then refactor. We look brutally for simplicity and clean code in this extension. Make sure that you pass all the tests. Make sure you have tested all the changes you've made, and keep the code as concise and clean as possible. Make sure that you follow the clean code principles.

you can find out how to delegate and follow up  with jules in ~/git/coas/skills/jules-delegation/

IMPORTANT update your progress in this document as you progress!

IMPORTANT Complete the outstanding tasks -- then follow /Users/jim/git/pi-tools-and-skills/prompts/refactor.md

## Executive decisions

1. **Do not ship `temperature` in bundled agent defaults.** Pi exposes `temperature` as a generic stream option, and several provider implementations map it correctly, but support is not universal at the model/API level. Defaults should be portable and boring.
2. **Keep generation parameters provider-aware.** User-specified `parameters` can remain supported, but they must be mapped or filtered per provider/model before reaching the payload.
3. **Make team behavior inspectable from the team file.** A user should be able to see which subagents, templates, tools, model bindings, and generation parameters a team run will use.
4. **Keep authored team manifests v2-only.** Runtime legacy state import/fallback is isolated from team manifest loading; copied v1 team files are not a compatibility target.

## Architecture decision records

### ADR-001 — Keep execution config and runtime data packaging separate

**Decision:** `tools` and provider `parameters` are execution config resolved before a child call; upstream graph/council/pair outputs are runtime data rendered into protocol templates. They are separate paths and must not share a generic "parameters" abstraction.

### ADR-002 — Prompt resolution is protocol-slot based

**Decision:** P2 uses open string prompt slots declared by protocol data, not TypeScript unions of built-in or test workflow names. Resolution precedence is deterministic: protocol default < subagent prompt < team prompt override < binding prompt override < binding literal. Team markdown bodies remain human notes unless explicitly referenced by a future opt-in slot.

### ADR-003 — Team run state is session-first with explicit visibility

**Decision:** P3 persists `pi-teams:run` delta events in the Pi session tree. Run state is not model-visible by default; protocols may opt in to a bounded model-visible summary event when a later phase needs prior run context.

### ADR-004 — Schema is protocol-first

**Decision:** P4 makes `protocol`/`engine` the dispatch source. Authored team manifests are strict `schemaVersion: 2`; `topology` is derived display metadata only, never used for handler selection, and not emitted by new `team_form` output.

### ADR-005 — Execution topology belongs in team configuration

**Decision:** P5 starts with deterministic DAG execution, but the target architecture is broader: no built-in team topology should be baked into TypeScript. Team files, agent bindings, prompt slots, limits, and explicit execution-policy fields should describe the workflow. TypeScript should provide generic execution primitives and validation, not hardcoded council/pair/telephone control flow.

### ADR-006 — Authored teams are v2 protocol files

**Decision:** New bundled and generated team files use `schemaVersion: 2`, `protocol`, object role bindings, and explicit prompt-slot maps. `topology` is retained only as derived in-memory display metadata so old UI affordances do not select execution.

### ADR-007 — Session state writes event deltas, not model-visible messages

**Decision:** `TeamStateManager` appends bounded `pi-teams:run` custom events (`run_started`, `phase_started`, `node_completed`, terminal/tombstone events) and rehydrates from the current session branch. Legacy JSON snapshots remain a local file fallback, but session events are the inspection surface.

### ADR-008 — Graph nodes are existing role bindings

**Decision:** P5 does not introduce a separate graph DSL. A graph node is a team role binding; edges, outputs, reducer, dependency policy, timeout, and concurrency are the minimal execution policy required for deterministic DAG runs.

### ADR-009 — Remove baked-in team topology from TypeScript

**Decision:** Council/debate, pair-coding, consult, and telephone are bundled team configurations, not TypeScript architecture boundaries. Their role names may exist in team, agent, and prompt files, but orchestration code must be factored into generic prompt packaging, node execution, sequencing, joins, retries, and bounded-iteration primitives. Obsolete wrapper modules such as `prompts.ts` and `pair-prompts.ts` are removed instead of preserved for compatibility.

### ADR-010 — Lower simple protocols before inventing new primitives

**Decision:** Consult and telephone lower onto the existing graph executor first. Live-agent consult refs are rejected until a generic live graph-node runner exists. Debate fanout/critique/synthesis and pair-coding's bounded fix loop remain separate until they can be expressed with small, explicit execution primitives rather than protocol-named orchestration modules.

### ADR-011 — Session rehydrate must not list global legacy runs

**Decision:** Once a Pi session branch has been rehydrated, `TeamStateManager.list()` is branch-scoped even when the branch has zero team events. Legacy JSON remains readable by explicit id fallback, but new/resumed/forked sessions do not automatically inherit unrelated global run files.

### ADR-012 — Debate lowering deletes bespoke orchestration before broad renames

**Decision:** Debate now lowers into ordinary graph nodes for generation, critique, and synthesis. The old live-agent deliberation runner and mailbox request path are removed from the execution surface instead of wrapped. Residual preflight helpers remain only for focused tests until the P6 naming cleanup removes legacy council terminology.

### ADR-013 — Bounded pair loops are unrolled DAGs

**Decision:** Pair-coding now lowers to a finite graph (`navigator_brief -> driver_implementation -> review/fix...`) using `maxFixPasses` for static unrolling. No cyclic graph edges, expression language, or pair-specific runner module is introduced.

### ADR-014 — Remove compatibility aliases instead of carrying legacy type names

**Decision:** P6 removes `CouncilDefinition`, `CouncilMember`, `LEGACY_TEAM_RUN_CUSTOM_TYPE`, and `CreateArgs.council` rather than preserving aliases. Tests now use `TeamRunDefinition`, `TeamParticipant`, and `team` fields directly.

### ADR-015 — Remove topology from runtime types and tool output

**Decision:** `topology` is no longer derived, stored on `TeamSpec`, accepted by `requireBuiltinTeam`, or returned by `team_list`. Protocol and explicit graph policy are the only execution selectors.

## Temperature support finding

`temperature` is supported by **some interfaces**, but not safely enough to use as a universal default.

Observed from Pi provider code:

- `openai-completions`: supports root-level `temperature`.
- `openai-responses` / `azure-openai-responses`: supports root-level `temperature`.
- `openai-codex-responses`: the interface includes `temperature`, but current Codex GPT-5.x models may reject it in practice.
- `anthropic`: supports `temperature` only when thinking is disabled.
- `google-generative-ai` / Vertex: supports `temperature` under `config` / generation config.
- `google-gemini-cli` / Cloud Code Assist: supports `temperature` under `request.generationConfig`, not at the root.
- `mistral` and `bedrock`: have provider-specific mappings.

Conclusion: `temperature` should be treated as a **provider/model capability**, not a portable manifest default.

## Remediation roadmap

```mermaid
flowchart TD
  P0[P0 Stabilize parameter handling]
  P1[P1 Execution config propagation]
  P2[P2 Explicit team/prompt/subagent contract]
  P3[P3 State in Pi session tree]
  P4[P4 Protocol-first schema]
  P5[P5 Graph execution engine]

  P0 --> P1
  P1 --> P2
  P2 --> P4
  P2 --> P3
  P3 --> P5
  P4 --> P5
```

## P0 — Stabilize provider/model parameter handling

**Status:** ✅ **COMPLETE**

**Goal:** Stop parameter defaults from breaking team runs across models while preserving advanced user control.

**Current state:**
- ✅ `temperature` removed from all `config/agents/*.md` files
- ✅ `team-form.ts` does not generate `temperature` defaults
- ✅ `provider-payload.ts` implements provider-aware merging:
  - `mergeCloudCodeAssistParameters()` → `request.generationConfig`
  - `mergeGoogleGenerateContentParameters()` → `config`
  - `mergeOpenAiCompatibleParameters()` → root-level with filtering
- ✅ `filterRootParameters()` filters `temperature` for GPT-5.x models

**Verified:**
```bash
$ grep -r "temperature" extensions/pi-teams/config/agents/  # No results
$ grep "temperature" extensions/pi-teams/team-form.ts  # No results
```

**Remaining work:** None — P0 is complete.

## P1 — Fully honor subagent and binding execution config

**Status:** ✅ **IMPLEMENTED; validation green**

**Goal:** Make `tools` and `parameters` in subagent manifests and team bindings mean exactly what they say for one-shot child model calls.

**Current state:**
- ✅ `GenerationConfig` type defined and used in handlers
- ✅ `team-handlers.ts` applies `memberConfigs` and `chairmanConfig` in `deliberate()`
- ✅ `pair-coding.ts` accepts `driverConfig` and `navigatorConfig`
- ✅ `team-graph.ts` applies binding config to graph nodes
- ✅ `provider-payload.ts` merges `parameters` per-provider

**Remaining work:** None for P1 scope. Any residual protocol-specific code path cleanup is tracked under P5.

## P2 — Make prompts explicitly linked to teams and subagents

**Status:** ✅ **COMPLETE**

**Goal:** Resolve the current ambiguity around why prompts are separate from team notes or subagent system prompts.

**Current state:**
- ✅ `protocol-contracts.ts` — defines prompt contract interfaces
- ✅ `prompt-resolver.ts` — resolves prompts with precedence chain
- ✅ `protocol-prompts.ts` — formats protocol context
- ✅ `prompt-renderer.ts` — template rendering
- ✅ Built-in teams use `promptId` metadata in subagent files

**Architecture implemented:**
- Subagent prompt = **who the role is** (identity/framing)
- Team spec = **which roles participate and how they are wired**
- Protocol template = **how dynamic upstream outputs are packaged**

**Remaining work:** None for P2 scope. Obsolete prompt wrapper modules have been removed; graph-core migration remains under P5.

## P3 — Move team run state into Pi's session tree

**Status:** ✅ **COMPLETE**

**Goal:** Team runs should branch, fork, resume, and compact with normal Pi sessions.

**Current state:**
- ✅ `state.ts` defines full event schema:
  - `TeamRunStartedEvent`, `TeamRunPhaseStartedEvent`, `TeamRunNodeCompletedEvent`
  - `TeamRunCompletedEvent`, `TeamRunFailedEvent`, `TeamRunTombstonedEvent`
  - `TeamRunLegacyImportedEvent`
- ✅ `TEAM_RUN_CUSTOM_TYPE = "pi-teams:run"`
- ✅ Session hooks registered in `index.ts`
- ✅ Bounds output persistence with `MAX_PERSISTED_OUTPUT_CHARS = 64_000`
- ✅ SHA-256 integrity metadata on outputs
- ✅ Rehydration from session branch before legacy JSON fallback
- ✅ Protocol-abstract state writer for consult, pair-coding, telephone, graph (not just debate)

**Remaining work:** None for P3 scope.

**Verified:**
- [x] Test reload/resume/fork branch replacement scenarios explicitly
- [x] Verify legacy council JSON fallback by id without listing global legacy runs after session rehydrate
- [x] Measure session file bloat controls with 70k-character output truncation/hash tests

**Assignee plan:** Add focused session lifecycle tests.

## P4 — Deprecate `topology` as first-class schema

**Status:** ✅ **IMPLEMENTED; validation green**

**Goal:** Simplify team authoring by making protocol/engine the execution selector.

**Current state:**
- ✅ Built-in team files (`config/teams/*.md`) do not include `topology`
- ✅ `team-form.ts` generates v2 manifests without `topology`
- ✅ Handlers dispatch by `protocol`, not `topology`
- ✅ `team-registry.ts` no longer derives or emits `topology`
- ✅ `team-types.ts` no longer defines `TeamTopology` or `TeamSpec.topology`

**Remaining work:** None for P4 scope. Derived display metadata is acceptable; authored v2 manifests are protocol-first.

## P5 — Promote graph execution to the core engine

**Status:** ✅ **COMPLETE — built-in protocols lower onto graph core**

**Goal:** Replace protocol-specific control flow with a DAG executor once config, prompts, and state are stable.

**Current state:**
- ✅ `team-graph.ts` implements full DAG execution:
  - Validates DAG shape (cycles, disconnected graphs, duplicate edges, unknown roles)
  - Deterministic topological level scheduling
  - Bounded concurrency
  - Direct-upstream prompt packaging
  - Per-node timeout and retry policy
  - Deterministic output reduction
- ✅ Graph-defined teams are integrated in `team-handlers.ts`
- ✅ Focused tests for validation, fanout, reduction, skipped dependents
- ✅ Removed obsolete council/pair prompt wrapper modules (`prompts.ts`, `pair-prompts.ts`)

**Remaining work:**
- [x] Spec consult/telephone lowering slice in `docs/teams-p5-protocol-lowering-slice.md`
- [x] Lower consult to a one-node graph and reject `agent:` refs clearly
- [x] Lower telephone to a linear graph using protocol prompt slots
- [x] Lower debate/council fanout, critique, and synthesis onto graph execution and delete bespoke deliberation runner
- [x] Replace pair-coding orchestration with bounded static graph unrolling
- [ ] Keep protocol-specific names in config data only where they are intentional built-in role labels

**Assignee plan:** Complete. Consult, telephone, debate, and pair-coding all lower through graph execution. P6 now owns residual naming/config cleanup.

---

## P6 — Remove legacy protocol assumptions (council/pair/telephone)

**Status:** ✅ **COMPLETE — legacy assumptions removed from runtime surface**

**Goal:** Eliminate hardcoded "council", "pair", "telephone" assumptions from types, modules, and prompts. Generalize to protocol-agnostic team slots driven entirely by configuration. This is the KISS/YAGNI cleanup pass to ensure the codebase does not bake in legacy protocol names.

**Current smells:**

1. **Module/function naming:**
   - `deliberation.ts` — council-specific name (should be `team-execution.ts` or similar)
   - `deliberate()` function — should be `runTeam()` or `executeTeam()`
   - `teamToDebateDefinition()` — should be `teamToRunDefinition()`

2. **Type naming:**
   - `CouncilDefinition` → should be `TeamRunDefinition`
   - `CouncilMember` → should be `TeamParticipant`

3. **Hardcoded protocol handlers:**
   - `team-handlers.ts` has separate `debateHandler`, `pairCodingHandler`, `pairConsultHandler`, `telephoneHandler`
   - These should either:
     - Be converted to graph specs (P5 completion), OR
     - Use a protocol contract registry where each protocol declares slots, phases, and templates

4. **Prompt keys:**
   - `debate/generation/system`, `debate/critique/system`, `debate/synthesis/system`
   - `pair-coding/navigator-brief/system`, `pair-coding/driver-implementation/system`, `pair-coding/navigator-review/system`
   - `telephone/relay/system`
   - Should normalize to: `{protocol}/{phase}/{slot}` format

5. **Settings structure:**
   - `resolveCouncilSettings()` — name implies council-only (should be `resolveTeamSettings()`)
   - `defaultCouncil`, `defaultPair` — should be `defaultTeams: Map<protocol, TeamDefaults>`

6. **State event naming:**
   - `LEGACY_TEAM_RUN_CUSTOM_TYPE = "pi-teams:deliberation"` — council-specific legacy marker
   - Phase names: "generating", "critiquing", "synthesizing" — council-specific
   - Should come from protocol contract, not hardcoded

7. **Agent file naming:**
   - `config/agents/council-*.md` — embed "council" in filenames
   - `config/agents/pair-*.md` — embed "pair" in filenames

**Work:**

1. **Rename core types:**
   - ✅ `CouncilDefinition` → `TeamRunDefinition`
   - ✅ `CouncilMember` → `TeamParticipant`
   - ✅ `deliberate()` execution path removed; graph-backed `runTeam()` dispatch is the execution path

2. **Generalize settings:**
   - ✅ `resolveCouncilSettings()` is gone; `resolveTeamSettings()` is the only settings resolver
   - ✅ `defaultCouncil`/`defaultPair`/`councils` compatibility fields removed; defaults resolve from team files by protocol ids

3. **Refactor handlers:**
   - ✅ P5 completed: built-ins lower through graph execution, with obsolete `deliberation.ts`, `agent-runner.ts`, and `pair-coding.ts` execution modules removed

4. **Normalize prompt keys:**
   - ✅ Prompt IDs use `{protocol}/{phase}/{slot}` style, e.g. `debate/generation/system`, `pair-coding/navigator-brief/system`, `telephone/relay/system`

5. **Audit and rename agent files:**
   - ✅ `council-*.md` → `debate-*.md`
   - ✅ `pair-*.md` → `pair-coding-*.md` or `consult-*.md`

6. **Update state events:**
   - Phase names from protocol contract, not hardcoded strings

**Assignee plan:** Architect to write P6 mini-spec with concrete rename list; Jules to execute in small, tested batches.

**Acceptance criteria:**

- [x] Runtime `topology` types/output removed
- [x] No runtime module names contain "council"
- [x] No runtime module names contain "pair"; `pair-coding.ts` was deleted
- [x] `resolveTeamSettings()` replaces `resolveCouncilSettings()`
- [x] `TeamRunDefinition` replaces `CouncilDefinition`
- [x] `runTeam()` graph-backed dispatch replaces `deliberate()`
- [x] Prompt keys use `{protocol}/{phase}/{slot}` convention
- [x] New custom workflows can be added via graph protocol config without TypeScript execution changes
- [x] `npm run check` and `npm test` pass

**Risks:**

- Breaking change for user teams referencing old prompt keys or agent names
- Large refactoring surface; must be done in small, tested increments

**KISS/YAGNI constraints:**

- ❌ Do NOT add backward compatibility shims
- ❌ Do NOT support v1 team manifests
- ❌ Do NOT preserve "council" naming for nostalgia
- ✅ Rename aggressively; let users update their team files
- ✅ Remove, don't deprecate

## Delegation plan

- **Architect / PM:** own specs, sequencing, review, and acceptance criteria.
- **Jules/local agents:** implement remaining P5 graph-lowering slices after each slice has a narrow spec and tests.
- **Local spawned agents:** audit behavior, run focused regression scans, and verify migration compatibility.
- **Pair navigator:** review each spec/patch for user-facing clarity and over-engineering risk before merge.

## Immediate next tasks

1. ✅ Create Jules task for **P0 parameter stabilization**.
2. ✅ Create/replace P1 execution config propagation work and local audit notes.
3. ✅ Draft a short P2 mini-spec that shows a concrete default-debate team file with explicit prompt/template inheritance.
4. ✅ Pair/navigator review requested locally after implementation because the built-in `team_run consult` tool is blocked by stale user-level copied team files in the live extension runtime.
5. ✅ Add/update tests to cover current protocol-first schema, prompt chains, session event registration, and graph validation/execution surfaces.
6. ✅ Start P3-P5 only after P0-P2 local validation was green.
7. ✅ Remove obsolete council/pair prompt wrapper modules and move tests onto protocol-neutral prompt helpers.
8. ⏳ Continue P5 graph-core migration; do not call P5 complete until protocol-specific handlers are removed or justified as explicit non-DAG engines.

## Latest validation

- `npm run check` passed: typecheck, Biome lint, knip, and type coverage (99.09%).
- `npm test` passed: 34 files, 376 tests.
- Refactor prompt follow-up completed: baseline `npm run check && npm test` green, `npm run knip` zero findings, and `tests/architecture.test.ts` green.
- P6 config cleanup completed: bundled agent/prompt filenames and prompt ids no longer use legacy `council*`, `pair*` shorthand; ids use protocol slot paths.
- P6 topology-removal grep passed: no `topology` or `TeamTopology` matches remain in `extensions/pi-teams`; unrelated task-brief tests still cover orchestration topology outside pi-teams.
- P6 alias-removal grep passed: no `CouncilDefinition`, `CouncilMember`, `LEGACY_TEAM_RUN_CUSTOM_TYPE`, `pi-teams:deliberation`, or `council?:` matches remain in `extensions/pi-teams` or `tests`.
- P5 consult/telephone lowering slice complete: both protocols now run through `runTeamGraph`; focused tests cover one-node consult lowering, linear telephone prompts, and deterministic outputs.
- Council review recommended a narrow evidence pass rather than a broad rewrite; resulting follow-up added protocol-abstract state writer methods, non-debate run instrumentation, and focused graph/state tests.
- Live `team_run consult` review could not run in this harness because the active installed extension sees a stale user-level `consult` v1 override; local spawned audit/navigation was used instead.
