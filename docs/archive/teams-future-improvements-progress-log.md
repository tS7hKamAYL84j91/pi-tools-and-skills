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

**Decision:** P4 makes `protocol` the dispatch source. Authored team manifests are strict `schemaVersion: 2`; `engine` aliases, `topology`, and legacy top-level model fields are not accepted or emitted by new `team_form` output.

### ADR-005 — Execution topology belongs in team configuration

**Decision:** P5 starts with deterministic DAG execution, but the target architecture is broader: no built-in team topology should be baked into TypeScript. Team files, agent bindings, prompt slots, limits, and explicit execution-policy fields should describe the workflow. TypeScript should provide generic execution primitives and validation, not hardcoded council/pair/telephone control flow.

### ADR-006 — Authored teams are v2 protocol files

**Decision:** New bundled and generated team files use `schemaVersion: 2`, `protocol`, object role bindings, and explicit prompt-slot maps. `topology` is not parsed, retained, emitted, or used for execution.

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

**Decision:** Debate now lowers into ordinary graph nodes for generation, critique, and synthesis. The old live-agent deliberation runner, mailbox request path, and preflight helper surface are removed instead of wrapped.

### ADR-013 — Bounded pair loops are unrolled DAGs

**Decision:** Pair-coding now lowers to a finite graph (`navigator_brief -> driver_implementation -> review/fix...`) using `maxFixPasses` for static unrolling. No cyclic graph edges, expression language, or pair-specific runner module is introduced.

### ADR-014 — Remove compatibility aliases instead of carrying legacy type names

**Decision:** P6 removes `CouncilDefinition`, `CouncilMember`, `TeamRunDefinition`, `LEGACY_TEAM_RUN_CUSTOM_TYPE`, and compatibility conversion helpers rather than preserving aliases. Tests now target protocol-neutral team registry, graph, prompt, runner, and state surfaces directly.

### ADR-015 — Remove topology from runtime types and tool output

**Decision:** `topology` is no longer derived, stored on `TeamSpec`, accepted by `requireBuiltinTeam`, or returned by `team_list`. Protocol and explicit graph policy are the only execution selectors.

### ADR-016 — Session state records are protocol-neutral

**Decision:** `TeamStateManager` no longer writes or rehydrates debate-shaped snapshots with generation/critique/synthesis fields, legacy file fallback, or `chairman` participants. The session branch contains only bounded protocol-neutral run, phase, node, completion, failure, and tombstone events; inspection reduces those events into generic phase/node records.

### ADR-017 — Synthesis replaces chairman as the debate output slot

**Decision:** Debate output is named `synthesis` in team bindings, model overrides, settings, prompt contracts, and tests. `chair`/`chairman` compatibility is removed; users should update authored team files to the v2 `synthesis` role and `models.synthesis` binding.

### ADR-018 — Protocol lowering is separate from handler dispatch

**Decision:** Refactor follow-up keeps runtime behavior unchanged but moves bundled protocol graph lowering into `team-lowering.ts`. `team-handlers.ts` now owns handler selection, progress/state recording, and result shaping only; lowering code owns protocol-to-graph planning and prompt packaging. This preserves the graph execution core while reducing the largest handler module below architecture limits.

### ADR-019 — No manifest compatibility aliases

**Decision:** Authored v2 team manifests use `protocol` and role binding `model` fields only. `engine`, `memberModels`, `synthesisModel`, `driverModel`, and `navigatorModel` parsing is removed from `team-registry.ts` instead of retained as compatibility surface. The obsolete `teams.ts` compatibility barrel is deleted; tests import concrete modules directly.

### ADR-020 — Role matching is a shared execution primitive

**Decision:** Protocol lowering and handler model-slot inspection use one shared role-binding matcher. This keeps fuzzy role matching (`role` and `role_*`) protocol-neutral and removes ad hoc fake-team wrappers from graph planning code.

### ADR-021 — Generated forms only create runnable built-in protocols

**Decision:** `team_form` does not offer `graph` until it can author explicit edges and output policy. Graph remains a supported runtime protocol for manually authored v2 team files; generated team files should be runnable without hidden follow-up edits.

### ADR-022 — Refactor closure is evidence-gated

**Decision:** After P3-P6 completion, do not keep rewriting working graph/state/registry code without a concrete smell, failing fitness function, or user-visible simplification. The refactor follow-up closes on objective evidence: green full validation, zero knip findings, architecture fitness green, no legacy runtime-symbol matches in `extensions/pi-teams`, and council/navigator review finding no blockers.

### ADR-023 — Team file rewrites preserve inspectable execution config

**Decision:** File-mutating helpers such as `team_models` must preserve prompt refs, binding prompt/template overrides, tools, parameters, graph policy, outputs, reducers, and limits when rewriting a team manifest. Generated built-in protocol teams must also be runnable without optional model inputs; debate generation therefore emits at least one member binding even when `models.members` is omitted.

### ADR-024 — Graph retries stay bounded and declarative

**Decision:** P5 retry support is a small graph execution policy, not a protocol-specific loop. `maxRetries` may be set globally in team limits, overridden on a role binding, or supplied at run time; retries apply only to child-call failures and do not retry parent cancellation or node timeouts.

### ADR-025 — Prompt asset IDs stay path-shaped

**Decision:** Built-in prompt asset IDs use protocol path names such as `graph/node/template`, not camelCase compatibility IDs. Prompt slot keys remain protocol-local map keys, but the referenced assets should be inspectable and grouped by protocol without TypeScript-only naming conventions.

### ADR-026 — Legacy cleanup is architecture-gated

**Decision:** The P6 cleanup is now guarded by an architecture fitness function, not only an ad hoc grep. Runtime `extensions/pi-teams` source/config files must not reintroduce removed compatibility symbols such as `council`, `chairman`, `topology`, legacy run custom types, or old compatibility type/function names. Intentional protocol labels such as `debate`, `consult`, `telephone`, and `pair-coding` remain allowed as team configuration vocabulary.

```mermaid
flowchart LR
  RuntimeFiles[extensions/pi-teams runtime files]
  Fitness[architecture.test.ts legacy cleanup rule]
  Suite[npm test / npm run check]
  Handoff[remediation handoff]

  RuntimeFiles --> Fitness --> Suite --> Handoff
```

### ADR-027 — Team manifests own the execution contract

**Decision:** P7 will not create a separate `config/protocols` catalog. A `protocol` may name a reusable execution primitive/family so many teams can share runtime behavior, but the team manifest is the inspectable source of truth for prompt refs, role bindings, limits, and explicit graph policy. Splitting those fields into protocol files duplicates team data and weakens the relationship among agents, prompts, and execution.

**Status:** Superseded in part by ADR-028. Moving prompt/model/form/lowering contracts wholesale into team manifests created too much mini-DSL surface.

### ADR-028 — Evaluate LangGraph before expanding protocol configuration

**Decision:** Pause the P7 team-local contract expansion and review LangGraph against the current custom DAG executor before adding more declarative protocol machinery. LangGraph may replace scheduling, fanout/join, retry, and state-transition plumbing, but Pi-specific prompt packaging, session events, one-shot model calls, live-agent routing, and inspectable tool output must remain explicit adapters. Migration is accepted only if a spike deletes more custom executor code than it adds in framework glue.

### ADR-029 — Live agents are explicit graph node bindings

**Decision:** P8 uses `subagent: "agent:<registered-name>"` as the only live-agent binding syntax. Live peers are executed by the generic graph node runner via a bounded Maildir request/response token, so scheduling, timeout, prompt packaging, output reduction, and session events stay in the existing graph path. Ambient team-level retries do not apply to live-agent nodes because each attempt sends an external request; retry requires an explicit binding or runtime override. Team files remain inspectable; live bindings do not create file-backed subagent manifest stubs and do not receive hidden tools, parameters, or transport details.

### ADR-030 — Do not migrate pi-teams to LangGraph now

**Decision:** P9 closes with a do-not-migrate decision. The branch-only spike at `origin/langgraph-spike` commit `94628e8` proved LangGraph can reproduce the current DAG semantics, but it did not produce objective simplification. Pi-specific adapters remain required for prompt packaging, session events, one-shot model calls, live-agent routing, retries, timeouts, cancellation, skipped dependents, and output reduction. The spike also added dependency/audit surface and required a structural cast for dynamic team role names. Keep the in-repo DAG executor until a future concrete requirement proves LangGraph deletes more code than it adds without reducing inspectability.

### ADR-031 — Close P7 as a non-change after the P9 spike

**Decision:** Do not continue the paused P7 protocol-contract extraction or team-local mini-DSL. Current v2 team manifests are already inspectable for role bindings, prompt refs, models, limits, and graph policy; moving the remaining built-in prompt/slot/lowering metadata into a larger manifest DSL would add authoring surface without a concrete user-visible simplification. Future protocol cleanup must be driven by a specific smell or failing fitness function, not by broad extraction goals.


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
- ✅ `team-handlers.ts` applies effective execution config through graph node bindings
- ✅ Pair-coding execution config is applied through graph-lowered driver/navigator bindings
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
- ✅ `TEAM_RUN_CUSTOM_TYPE = "pi-teams:run"`
- ✅ Session hooks registered in `index.ts`
- ✅ Bounds output persistence with `MAX_PERSISTED_OUTPUT_CHARS = 64_000`
- ✅ SHA-256 integrity metadata on outputs
- ✅ Rehydration from session branch only; legacy JSON fallback removed
- ✅ Protocol-abstract state writer and reducer for consult, pair-coding, telephone, graph, and debate

**Remaining work:** None for P3 scope.

**Verified:**
- [x] Test reload/resume/fork branch replacement scenarios explicitly
- [x] Remove legacy council JSON fallback instead of carrying compatibility state
- [x] Measure session file bloat controls with 70k-character output truncation/hash tests

**Assignee plan:** Add focused session lifecycle tests.

## P4 — Deprecate `topology` as first-class schema

**Status:** ✅ **IMPLEMENTED; validation green**

**Goal:** Simplify team authoring by making `protocol` the execution selector.

**Current state:**
- ✅ Built-in team files (`config/teams/*.md`) do not include `topology`
- ✅ `team-form.ts` generates v2 manifests without `topology`
- ✅ Handlers dispatch by `protocol`, not `topology`
- ✅ `team-registry.ts` no longer derives or emits `topology`
- ✅ `team-registry.ts` no longer accepts `engine` aliases or legacy top-level model fields
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
  - Per-node timeout and bounded retry policy
  - Deterministic output reduction
- ✅ Graph-defined teams are integrated in `team-handlers.ts`
- ✅ Focused tests for validation, fanout, reduction, skipped dependents
- ✅ Removed obsolete council/pair prompt wrapper modules (`prompts.ts`, `pair-prompts.ts`)

**Remaining work:**
- [x] Spec consult/telephone lowering slice in `docs/archive/teams-p5-protocol-lowering-slice.md`
- [x] Lower consult to a one-node graph and reject `agent:` refs clearly
- [x] Lower telephone to a linear graph using protocol prompt slots
- [x] Lower debate/council fanout, critique, and synthesis onto graph execution and delete bespoke deliberation runner
- [x] Replace pair-coding orchestration with bounded static graph unrolling
- [x] Keep protocol-specific names only where they are intentional built-in labels or explicit graph-lowering helpers

**Assignee plan:** Complete. Consult, telephone, debate, and pair-coding all lower through graph execution. P6 now owns residual naming/config cleanup.

---

## P6 — Remove legacy protocol assumptions (council/pair/telephone)

**Status:** ✅ **COMPLETE — legacy compatibility surface removed; built-ins lower through graph helpers**

**Goal:** Eliminate hardcoded "council", "pair", "telephone" assumptions from types, modules, and prompts. Generalize to protocol-agnostic team slots driven entirely by configuration. This is the KISS/YAGNI cleanup pass to ensure the codebase does not bake in legacy protocol names.

**Original smells (closed or converted to graph-lowering helpers):**

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
   - ✅ `CouncilDefinition`/`CouncilMember` removed; `TeamParticipant` remains for protocol-local labels
   - ✅ `TeamRunDefinition` compatibility type removed
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
   - ✅ Phase names are protocol ids, not hardcoded debate statuses
   - ✅ `TeamRunRecord` is protocol-neutral (`phases[]`, `nodes[]`, `summary`) and no longer stores debate-shaped generation/critique/synthesis snapshots
   - ✅ Legacy file-backed state and live-agent request prompt leftovers removed

7. **Rename debate output role:**
   - ✅ `chairman` role/model/settings/tool wording replaced with `synthesis`
   - ✅ Built-in default debate team uses `role: "synthesis"` and `models.synthesis`

**Assignee plan:** Architect to write P6 mini-spec with concrete rename list; Jules to execute in small, tested batches.

**Acceptance criteria:**

- [x] Runtime `topology` types/output removed
- [x] Manifest compatibility aliases (`engine`, `memberModels`, `synthesisModel`, `driverModel`, `navigatorModel`) removed
- [x] `teams.ts` compatibility barrel removed
- [x] No runtime module names contain "council"
- [x] No runtime module names contain "pair"; `pair-coding.ts` was deleted
- [x] `resolveTeamSettings()` replaces `resolveCouncilSettings()`
- [x] `TeamRunDefinition` compatibility type removed with `CouncilDefinition`
- [x] `runTeam()` graph-backed dispatch replaces `deliberate()`
- [x] Prompt asset IDs use `{protocol}/{phase}/{slot}` convention; team prompt slot keys remain short protocol-local names such as `navigatorBrief.system`
- [x] New custom workflows can be added via graph team configuration without TypeScript execution changes
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

---

## P7 — Make team manifests the execution contract

**Status:** ✅ **CLOSED — no broad protocol DSL after P9 spike**

**Goal:** Keep each team file self-contained and inspectable without growing a bespoke protocol mini-language. The P7 extraction idea was evaluated and narrowed: current v2 team files already show the execution-critical facts users need (roles, prompt refs, model bindings, tools/parameters, limits, and graph policy). The attempted broader move of prompt-slot contracts, model slots, form hints, and lowering policy into manifests was rejected as extra DSL surface.

**Decision path:**

- ADR-027 rejected a separate `config/protocols` catalog because it would duplicate team data.
- ADR-028 paused team-local contract expansion until the graph runtime question was answered.
- P9's spike showed LangGraph did not simplify enough to justify a new dependency or more abstraction.
- ADR-031 closes P7 as a non-change: do not add manifest fields until a concrete user-visible gap demands them.

**Current inspectable contract:**

- Built-in team manifests declare `schemaVersion: 2`, `protocol`, role bindings, prompt refs, model bindings, limits, and any explicit graph policy.
- Authored graph teams can already be added by manifest only when they provide `protocol: "graph"`, role bindings, edges, and outputs.
- TypeScript keeps only the current generic execution primitives and the small built-in protocol lowering helpers needed by existing bundled workflows.

**Work:**

1. **Do not add protocol config files or a team-local DSL:**
   - ✅ No `extensions/pi-teams/config/protocols/*` catalog is introduced.
   - ✅ No compatibility aliases or v1 manifest support are added.
   - ✅ Existing v2 team files remain the inspectable source for execution configuration.

2. **Keep current code unless evidence appears:**
   - ✅ `PROTOCOL_PROMPT_CONTRACTS` remains a small implementation table for current built-ins rather than expanding into a new user-facing schema.
   - ✅ Built-in protocol branches remain only where they represent current bundled workflows and graph-lowering helpers.
   - ✅ Further extraction is deferred until a concrete smell, failing architecture test, or user-visible simplification exists.

**Acceptance criteria:**

- [x] Separate protocol config files were not added.
- [x] Team-local contract expansion was evaluated and rejected as over-engineering.
- [x] Graph-backed custom teams remain addable by team manifest only.
- [x] LangGraph was evaluated before further protocol extraction.
- [x] `npm run check`, `npm test`, and architecture tests pass after closing the decision.

**KISS/YAGNI constraints:**

- ❌ Do not introduce a large DSL or expression language.
- ❌ Do not add separate protocol config files that duplicate team definitions.
- ❌ Do not add compatibility aliases for old protocol names or prompt ids.
- ✅ Keep v2 manifests clear and inspectable.
- ✅ Make future protocol cleanup evidence-gated.

---

## P8 — Select existing live agents as team members

**Status:** ✅ **IMPLEMENTED; validation green**

**Goal:** Let users and agents select currently available Pi peer agents as team members, not only file-backed subagent manifests or model ids. A team author should be able to choose `agent:coas` or another registered peer from the same discovery surface used by Panopticon, and team execution should route that node to the live agent safely.

**Observed gap:**

- ✅ `team_form` writes explicit `agent:<name>` refs and skips subagent stub generation for them.
- ✅ `team_run` routes live refs through generic graph node execution instead of rejecting them as invalid subagent ids.
- ✅ P5 consult lowering no longer rejects live navigator bindings; live execution remains graph-runner behavior.

**Work:**

1. **Define live-agent binding syntax:**
   - Use one explicit form, e.g. `agent:<registered-name>`.
   - Do not infer live agents from arbitrary invalid subagent ids.
   - Keep file-backed subagent ids and model ids distinct.

2. **Expose selection to users:**
   - `team_form` interactive UI should list registered agents alongside subagent manifests where protocol roles allow live agents.
   - Tool/API callers should be able to pass live-agent refs in `agents[]` or role bindings.
   - Error messages should show available agent names when a live-agent ref cannot be resolved.

3. **Expose selection to agents:**
   - Tool schemas/descriptions should document the `agent:<name>` form.
   - `team_describe` and `team_list` should make live-agent bindings inspectable.
   - Avoid hidden runtime-only magic; the team file should reveal which roles use live peers.

4. **Implement a generic live graph-node runner:**
   - Add an execution path for graph nodes bound to live agents.
   - Reuse existing agent messaging/RPC primitives where possible.
   - Preserve timeout, cancellation, retry, prompt packaging, state events, and output reduction semantics.
   - Live-agent support must be generic graph execution behavior, not consult-specific branching.

5. **Validate lifecycle and safety:**
   - Detect unavailable, self, terminated, blocked, or stalled agents clearly before or during execution.
   - Do not send secrets or hidden config; send only the rendered role prompt/package intended for that node.
   - Record live-agent node metadata in session state without leaking private transport details.

**Acceptance criteria:**

- [x] A team can bind a role to `agent:<registered-name>` and pass validation.
- [x] `team_form` can create such a team from interactive entry and tool-call arguments.
- [x] `team_run` executes a live-agent-bound node and captures its response in graph output/state.
- [x] `team_describe` shows live-agent bindings clearly.
- [x] Missing/unavailable live agents produce actionable errors.
- [x] Live-agent support works through generic graph execution, not protocol-specific handler branches.
- [x] `npm run check`, `npm test`, and focused live-agent tests pass.

**KISS/YAGNI constraints:**

- ❌ Do not add distributed orchestration or multi-agent chat rooms.
- ❌ Do not add broad compatibility for old invalid agent ids.
- ❌ Do not bypass graph/state/prompt-contract paths.
- ✅ Add the smallest live-node runner needed for existing registered agents.
- ✅ Keep authored team files explicit and inspectable.

---

## P9 — Evaluate LangGraph before further protocol extraction

**Status:** ✅ **COMPLETE — spike done; do not migrate now**

**Goal:** Determine whether LangGraph would reduce the custom TypeScript needed for team graph planning/execution before adding more protocol/config machinery. If it materially simplified the implementation without hiding Pi-specific state, prompts, cancellation, or agent routing, migrate to it; otherwise keep the in-repo graph executor.

**Decision:** Keep the in-repo DAG executor. Do not merge the LangGraph dependency or spike branch into `main`.

**Evaluation:** `docs/archive/teams-p9-langgraph-evaluation.md`

**Spike evidence:**

- Branch-only prototype: `origin/langgraph-spike` at commit `94628e8` (`Spike LangGraph team graph adapter`).
- Prototype coverage: fanout/concurrency, skipped dependents, bounded retries, timeout non-retry behavior, parent cancellation, and output reduction.
- Prototype validation: `npm run check` and `npm test` green on the spike branch (34 files, 374 tests).
- Prototype cost: 229 lines of spike test/adapter code, `package-lock.json` +389 lines, and five added dev dependencies/peers (`@langchain/langgraph`, `@langchain/core`, `zod`, `zod-to-json-schema`, plus lockfile transitives).
- Audit delta: current `main` already reports 15 audit findings; the LangGraph spike branch reports 19, adding four moderate dependency findings tied to LangGraph packages and shared `uuid` transitives.
- Simplification result: zero net reduction in abstraction complexity. Pi-specific wrappers still own prompt packaging, session events, model/live-agent routing, retry/timeout/cancellation semantics, skipped-dependent behavior, and output reduction.
- Type result: dynamic team role names required a structural cast around LangGraph's statically narrowed node-name generics.

**Council/navigator review:**

- Council review recommended closing P9 with a do-not-migrate decision: the spike proves feasibility, not necessity.
- Navigator review agreed with the KISS/YAGNI direction and requested stronger wording around abstraction complexity, type inference loss, and audit evidence.
- Local audit agent agreed: LangGraph is viable but unnecessary for the current static lowered graph model.

**Acceptance criteria:**

- [x] LangGraph spike document exists with a do-not-migrate recommendation.
- [x] Branch-only prototype proves retries, timeouts, cancellation, skipped dependents, and output reduction can be preserved only by keeping Pi-owned wrappers.
- [x] Migration was rejected because it does not delete more custom graph code than it adds in adapters/config glue.
- [x] `npm run check`, `npm test`, and focused graph tests passed on the spike branch.
- [x] Main stays dependency-clean: no LangGraph package or lockfile changes are merged.

**KISS/YAGNI constraints:**

- ❌ Do not add LangGraph just because it is popular.
- ❌ Do not hide team behavior behind opaque framework callbacks.
- ❌ Do not migrate without objective code deletion and audit posture improvement.
- ✅ Prefer the current small executor because LangGraph does not clearly reduce code or complexity now.
- ✅ Revisit only for a concrete future requirement such as durable graph checkpoints, human-in-the-loop graph state, or substantial deletion of Pi-owned scheduling code.

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
8. ✅ P5 graph-core migration completed; remaining protocol-specific names are intentional built-in protocol labels or graph-lowering helpers.
9. ✅ P7 closed as a non-change after the LangGraph spike showed no protocol-config extraction simplification.
10. ✅ P8 live-agent bindings implemented through generic graph-node execution.
11. ✅ P9 LangGraph evaluation completed with a do-not-migrate decision.

## Latest validation

- 2026-05-04 requested closure refresh: no outstanding P7-P9 feature work remains. Baseline commit before this evidence note: `c49ce62`. `npm run check` passed (typecheck, Biome, knip, type coverage 99.09%), `npm test` passed (33 files, 369 tests), `npm test -- tests/architecture.test.ts` passed (16 tests), and standalone `npm run knip` returned zero findings. Forbidden legacy-symbol grep under `extensions/pi-teams` returned no output. Refactor prompt follow-up found no production-code change justified: deletion log none; purity report unchanged because no side effects were moved; LangGraph dependency check remains false for direct `@langchain/langgraph`/`@langchain/core`. Council (`team_run default-debate`) found no concrete KISS/YAGNI blockers; consult review did not identify any actionable blocker.
- 2026-05-04 final closure verification: no outstanding P7-P9 feature work remains. Baseline commit before this evidence note: `62eea6a`. `npm run check` passed (typecheck, Biome, knip, type coverage 99.09%), `npm test` passed (33 files, 369 tests), `npm test -- tests/architecture.test.ts` passed (16 tests), and standalone `npm run knip` returned zero findings. Refactor prompt follow-up found no production-code change justified: deletion log none; purity report unchanged because no side effects moved; LangGraph dependency check remains false for direct `@langchain/langgraph`/`@langchain/core`; forbidden legacy-symbol grep under `extensions/pi-teams` returned no output. Local spawned audit agent found no concrete blockers and focused validation green (`tests/architecture.test.ts`, `tests/live-agent.test.ts`, `tests/team-graph.test.ts`, `tests/team-registry.test.ts`: 4 files, 58 tests). Navigator (`team_run consult`) replied `None`; Council (`team_run default-debate`) found no concrete KISS/YAGNI blockers. Git status was clean before this documentation evidence update.
- 2026-05-04 closure refresh: P7 remains intentionally closed as a non-change, P8 live-agent support remains implemented, and P9 remains do-not-migrate. Baseline commit before this evidence note: `56bbdf9`. Baseline/refactor verification stayed green with no production-code refactor needed. Deletion log: none. Knip report: zero findings via `npm run check`. Type coverage: 99.09%. Architecture fitness: `npm test -- tests/architecture.test.ts` green (16 tests). Test results: `npm test` green (33 files, 369 tests). Purity report: no side-effect movement required because the refresh only updates handoff evidence. LangGraph dependency sanity check: no direct `@langchain/langgraph` or `@langchain/core` dependency is present on `main`. Local audit agent, Navigator (`team_run consult`), and Council (`team_run default-debate`) found no concrete KISS/YAGNI blockers.
- 2026-05-03 refactor prompt follow-up after P9: baseline and verification stayed green with no production-code refactor needed. Deletion log: none. Knip report: zero findings via `npm run check`. Architecture fitness: `npm test -- tests/architecture.test.ts` green (16 tests). Test results: `npm test` green (33 files, 369 tests). Purity report: no side-effect movement required because the P9 closure changed documentation only.
- 2026-05-03 P9 LangGraph decision completed: pushed branch-only spike `origin/langgraph-spike` at `94628e8`, proving LangGraph can preserve fanout/concurrency, skipped dependents, retries, timeout non-retry behavior, parent cancellation, and output reduction. Spike validation green: `npm run check` and `npm test` (34 files, 374 tests). Decision: do not merge LangGraph because it produced zero net reduction in abstraction complexity, added dependency/audit surface, and weakened type inference for dynamic team roles. Council, navigator, and local audit review agreed with closing P9 as do-not-migrate. Main validation green after docs update: `npm run check`, `npm test`, and `npm test -- tests/architecture.test.ts`.
- 2026-05-03 P8 live-agent support implemented: added `agent:<registered-name>` role bindings, team form stub skipping, registry validation, tool/describe inspectability, and a generic graph-node Maildir request/response runner. Council review identified two blockers; follow-up now archives stale protocol replies safely and prevents ambient team-level retry policy from resending live-agent requests by default. Focused tests cover ref parsing, request packaging, response capture, fresh unmatched reply preservation, stale protocol reply archiving, unavailable/self rejection, cancellation, team form output, registry warnings, graph validation, and live-node retry behavior. Validation green: `npm run check`, `npm test` (33 files, 369 tests; rerun green after one random soak threshold flake), and `npm test -- tests/architecture.test.ts`.
- 2026-05-03 LangGraph pivot: paused the P7 team-local contract expansion as too complex, reverted the uncommitted implementation spike, stopped local spawned review agents, and wrote `docs/archive/teams-p9-langgraph-evaluation.md`. Jules status checked; one unrelated testing-improvement Jules session is still in progress and the CLI exposes no cancel/close command, while older sessions are completed or awaiting user feedback.
- 2026-05-03 architecture hardening refresh: added an architecture fitness function that fails if `extensions/pi-teams` runtime source/config files reintroduce removed legacy symbols (`council`, `chairman`, `topology`, old compatibility type/function names, or legacy run custom types). Navigator review and council review both found no true KISS/YAGNI blockers for closure. Validation green: `npm run check`, `npm test` (32 files, 360 tests), `npm test -- tests/architecture.test.ts` (16 tests), and `npm run knip` (zero findings). Fresh legacy runtime-symbol grep over `extensions/pi-teams` returned no output.
- 2026-05-03 refactor closure refresh: local audit found no P3-P6 blockers and one tiny duplication cleanup. Reused `graphNodeDetails()` in the graph handler and renamed the generic graph prompt asset from `teamGraphNodeTemplate` to `graph/node/template` to keep prompt IDs path-shaped. Validation green: `npm run check`, `npm test` (32 files, 359 tests), and `npm test -- tests/architecture.test.ts`. Fresh legacy runtime-symbol grep over `extensions/pi-teams` returned no output; council review found no blockers.
- 2026-05-03 final evidence refresh: local audit found a P5 documentation/code mismatch: graph retry policy was claimed but not implemented. Fixed with bounded `maxRetries` policy on team limits, role bindings, and runtime limits; `team_models` rewrites preserve it. Focused retry tests cover successful retry, runtime override precedence (`maxRetries: 0`), and timeout non-retry behavior. Validation green: `npm run check`, `npm test` (32 files, 359 tests), and `npm test -- tests/architecture.test.ts`. Fresh legacy runtime-symbol grep over `extensions/pi-teams` returned no output. Live navigator (`team_run consult`) and council (`team_run default-debate`) reviews found no true KISS/YAGNI blockers after the fix.
- 2026-05-03 evidence refresh: local audit found two `team-form.ts` blockers (`team_form` debate without members; lossy `team_models` rewrite). Both are fixed and reviewed by the audit agent, council (`team_run default-debate`), and navigator (`team_run consult`) with no remaining true KISS/YAGNI blockers. Validation green: `npm run check`, `npm test` (32 files, 356 tests), and `npm test -- tests/architecture.test.ts`. Legacy runtime-symbol grep still only reports unrelated `tests/task-brief.test.ts` topology fixtures outside `extensions/pi-teams`.
- Final handoff verification passed on 2026-05-03: `npm run check && npm test` green, `tests/architecture.test.ts` green, and `git status` clean on `main...origin/main` before this progress note.
- `npm run check` passed: typecheck, Biome lint, knip, and type coverage (99.05%).
- `npm test` passed: 32 files, 354 tests.
- Council review (`team_run default-debate`) found no true KISS/YAGNI blockers requiring code changes before handoff.
- Navigator review (`team_run consult`) found no true blockers requiring code changes before handoff.
- Local audit agent found P3-P6 claims consistent with code at a high level; legacy compatibility surface appears removed and built-ins lower through graph execution.
- Refactor prompt follow-up completed: baseline `npm run check && npm test` green, `npm run knip` zero findings, and `tests/architecture.test.ts` green.
- Refactor pass 2 completed: extracted protocol graph-lowering/prompt-packaging from `team-handlers.ts` to `team-lowering.ts`; `team-handlers.ts` is now 238 lines and focused on dispatch/state/result shaping. Validation green: `npm run check` and `npm test`.
- Compatibility cleanup completed: removed `engine` and legacy top-level model field parsing from `team-registry.ts`, deleted the obsolete `teams.ts` compatibility barrel, cleaned stale chair/council wording in config and generic tests, and verified no legacy-name matches remain in `extensions/pi-teams` or tests except unrelated task-brief topology fixtures. Validation green: `npm run check && npm test`.
- P6 config cleanup completed: bundled agent/prompt filenames and prompt ids no longer use legacy shorthand; ids use protocol slot paths.
- Refactor pass 3 completed: extracted shared role-binding lookup to `team-bindings.ts`, removed duplicate/fake-team role matching in `team-handlers.ts` and `team-lowering.ts`, and kept behavior unchanged. Validation green: `npm run check && npm test` (32 files, 354 tests, type coverage 99.05%, knip zero findings).
- Navigator review follow-up completed: corrected P3 event documentation, clarified prompt asset-id vs prompt-slot naming, stopped advertising unsupported `agent:` refs as navigator model input, and removed `graph` from generated `team_form` protocol choices because graph teams need explicit manual edge policy. Validation green: `npm run check && npm test` (32 files, 354 tests, type coverage 99.05%, knip zero findings).
- P6 topology-removal grep passed: no `topology` or `TeamTopology` matches remain in `extensions/pi-teams`; unrelated task-brief tests still cover orchestration topology outside pi-teams.
- P6 legacy-name grep passed for `extensions/pi-teams` and team tests: no `council`, `chairman`, `TeamRunDefinition`, `LEGACY_TEAM_RUN_CUSTOM_TYPE`, `pi-teams:deliberation`, or old conversion helpers remain.
- Refactor prompt follow-up removed dead compatibility files (`agent-ref.ts`, `preflight.ts`, unused live-agent request/framing prompts), renamed tests to team-oriented names, and simplified session state to protocol-neutral event reduction.
- P5 consult/telephone lowering slice complete: both protocols now run through `runTeamGraph`; focused tests cover one-node consult lowering, linear telephone prompts, and deterministic outputs.
- Council review recommended a narrow evidence pass rather than a broad rewrite; resulting follow-up added protocol-abstract state writer methods, non-debate run instrumentation, and focused graph/state tests.
- Live `team_run consult` review could not run in this harness because the active installed extension sees a stale user-level `consult` v1 override; local spawned audit/navigation was used instead.
