# P4 Mini-Spec: Protocol-First `pi-teams` Schema Simplification

> Status: historical mini-spec. Current implementation is stricter than this draft: authored team manifests require `schemaVersion: 2`, `protocol`, object role bindings, and role-level `model` fields. `engine`, `topology`, legacy top-level model fields, and compatibility barrels are removed; see `docs/teams-future-improvements-todo.md` ADR-015 and ADR-019.

## Goal

Make `protocol` the sole execution selector for `pi-teams`; remove `topology` as an authored/primary concept and keep authored team manifests strict v2-only.

P4 must follow the P2 prompt contract: prompt/system/template resolution remains **protocol-slot based**, not topology based.

---

## Core decisions

1. **Authored v2 team files are protocol-first**
   - `schemaVersion: 2`
   - Require `protocol`.
   - Omit `engine` and `topology`.
   - Built-in team files should be rewritten to v2 and drop `topology`.

2. **`topology` is removed**
   - Do not use `topology` for handler dispatch, prompt fallback, model-slot selection, execution validation, details, or UI output.
   - Do not infer `protocol` from `topology`.

3. **v1 authored teams do not load**
   - Existing copied built-ins with `schemaVersion: 1`, missing schema, legacy string agents, or topology-only selection are rejected.
   - Runtime legacy state fallback is separate from authored team manifest parsing.
   - Users migrate team files by writing `schemaVersion: 2`, `protocol`, and object role bindings.

4. **No manifest aliases**
   - `engine` is not accepted as an alias.
   - Top-level `memberModels`, `synthesisModel`, `driverModel`, and `navigatorModel` are not accepted as model bindings.
   - Generated files write `protocol` and role binding `model` fields only.

5. **No topology fallback**
   - If a team has `topology` but no `protocol`, reject it.
   - Prompt contracts and defaults must choose by protocol slots only.

---

## Target schema direction

### v2 team front matter

```yaml
---
schemaVersion: 2
id: "default-debate"
name: "Default Council"
description: "General high-stakes reasoning and architecture review."
protocol: "debate"

prompts:
  generation.system: "council-generation-system"
  critique.system: "council-critique-system"
  critique.template: "council-critique-template"
  synthesis.template: "council-synthesis-template"

agents:
  - role: "member"
    subagent: "debate_generation_member"
    model: "openai-codex/gpt-5.5"
    label: "Member 1"
  - role: "critic"
    subagent: "debate_critic"
  - role: "chairman"
    subagent: "debate_synthesis"
    model: "openai-codex/gpt-5.5"
---
Human notes only; not injected into model calls.
```

### In-memory normalized shape

Keep compatibility, but mark topology deprecated:

```ts
export type TeamSchemaVersion = 1 | 2;

export interface TeamSpec {
  schemaVersion: TeamSchemaVersion;
  id: string;
  name: string;
  description?: string;

  /** Primary execution selector. */
  protocol: TeamProtocol;

  /**
   * @deprecated Compatibility/display only. Do not use for execution dispatch,
   * prompt fallback, validation, or generated files.
   */
  topology?: TeamTopology;

  agents: string[];
  agentBindings: TeamAgentBinding[];
  graph?: TeamGraph;
  chair?: string;
  models: TeamModels;
  limits: TeamLimits;
  source: TeamSource;
  path: string;

  // From P2:
  prompts: TeamPromptRefs;
}
```

If keeping `topology` required is less invasive, it may remain required for one release, but all code changed in P4 must treat it as deprecated output-only metadata.

---

## Protocol metadata

Add a small protocol registry/helper in `team-registry.ts` or adjacent helper:

```ts
interface TeamProtocolDefinition {
  protocol: TeamProtocol;
  displayTopology?: TeamTopology;
  validRoles: string[];
}
```

Initial definitions:

| Protocol | Display topology | Notes |
|---|---:|---|
| `debate` | `council` | Council generation / critique / synthesis |
| `consult` | `pair` | Single navigator consult |
| `pair-coding` | `pair` | Driver / Navigator loop |
| `telephone` | `chain` | Sequential relay |
| `graph` | none or derived only for display | Do not force chain/pair/council fallback |

Use this registry for display metadata and validation, not for inferring protocol from topology.

---

## Backward compatibility and migrations

### Read-time validation

`team-registry.ts` normalizes accepted files into `TeamSpec`:

1. Accept:
   - v2 with `protocol`
   - v2 with `engine`
2. Reject:
   - missing `schemaVersion: 2`
   - missing `protocol` and `engine`
   - unsupported protocol/engine
   - both `protocol` and `engine` present but different
   - legacy string-form or mixed `agents`
   - object bindings without `role` and `subagent`
3. Preserve current v2 fields:
   - object-form `agents`
   - `memberModels`, `chairmanModel`, `driverModel`, `navigatorModel` model slots
   - `chair`
   - P2 prompt ids/templates
4. Put invalid manifest diagnostics in `registry.warnings`; do not add a deprecation path for old schemas.

### Write-time migration

Mutating tools should write v2:

- `team_form` creates `schemaVersion: 2`, `protocol`, no `topology`.
- `team_models` rewrites user/project overrides as v2.
- Do not auto-edit existing user/project files during registry load.
- Do not seed or copy bundled built-ins into user team roots during extension startup.

### Existing copied built-ins

Old copied files like this do not load:

```yaml
schemaVersion: 1
topology: "pair"
protocol: "consult"
```

They must be migrated to v2:

```yaml
schemaVersion: 2
protocol: "consult"
agents:
  - role: "navigator"
    subagent: "consult_navigator"
```

---

## Implementation touch points

### Required scope

#### `extensions/pi-teams/team-types.ts`

- Add `TeamSchemaVersion = 1 | 2`.
- Make `TeamSpec.schemaVersion` accept `1 | 2`.
- Deprecate `TeamTopology`.
- Prefer optional/deprecated `TeamSpec.topology`.
- Ensure P2 prompt refs remain open string protocol slots, not hardcoded TypeScript unions of built-in workflows.

#### `extensions/pi-teams/team-registry.ts`

- Replace schemaVersion check with v1/v2 support.
- Parse `protocol` and `engine` through one normalization function.
- Reject missing protocol/engine; do not infer from topology.
- Split invalid warnings from deprecation notices.
- Change:
  - `legacyAgentBindings`
  - `modelsFromBindings`
  - `validateTeam`
  - `requireBuiltinTeam`
  - `teamToCouncilDefinition`
  - `teamToPairDefinition`
- All of the above should reason from `protocol` + roles, not topology.
- Keep existing legacy aliases/migration behavior.

#### `extensions/pi-teams/team-handlers.ts`

- Handler `matches()` must use protocol/roles:
  - `debateHandler`: `team.protocol === "debate"`
  - `pairCodingHandler`: `team.protocol === "pair-coding"`
  - `pairConsultHandler`: `team.protocol === "consult"`
  - `telephoneHandler`: `team.protocol === "telephone"`
  - `graphHandler`: graph edges or `team.protocol === "graph"`
- Model slots should be selected by protocol.
- Do not inspect topology for prompt resolution or execution dispatch.

#### `extensions/pi-teams/config/teams/*.md`

- Update built-ins to:
  - `schemaVersion: 2`
  - keep `protocol`
  - remove `topology`
  - preserve IDs, agents, role bindings, P2 prompt mappings, and model defaults.

#### `tests`

Update/add focused tests in `tests/council-teams.test.ts` and related prompt/handler tests.

#### `docs/teams-future-improvements-todo.md`

- Mark P4 spec direction.
- Note that topology is deprecated, not deleted from read compatibility.
- Document that v2 authored files use protocol/engine only.

---

### Adjacent required touch points

These are outside the narrow file list but likely required to satisfy acceptance:

- `extensions/pi-teams/team-form.ts`
  - Write schema v2.
  - Remove topology prompt from interactive form.
  - Validate by protocol only.
- `extensions/pi-teams/team-runtime.ts`
  - Remove/de-emphasize `topology` from `team_form` schema.
  - Keep optional deprecated input if compatibility is desired.
  - Update descriptions: “protocol/engine”, not “topology/protocol”.
- `extensions/pi-teams/team-tools.ts`
  - `team_list`: display `protocol` first.
  - `team_describe`: show `Protocol: ...`; show `Derived topology: ...` only if useful.
- `extensions/pi-teams/team-overlay.ts`
  - Same display treatment.
- `extensions/pi-teams/team-models.ts`
  - Team picker descriptions should use protocol primary.
- `extensions/pi-teams/teams.ts`
  - Re-export updated types/functions.

---

## Test plan

### Registry/schema tests

1. **v2 protocol-only built-ins load**
   - Built-in team files have no `topology:` line.
   - `loadTeamRegistry(CONFIG_PATH, { roots: [] })` returns default teams.
   - No invalid warnings.

2. **v2 `engine` alias loads**
   - Team with `engine: "consult"` and no `protocol` loads as `protocol === "consult"`.

3. **`protocol` + `engine` mismatch rejects**
   - `protocol: "consult"`, `engine: "debate"` produces clear diagnostic.

4. **v1 copied built-ins are rejected**
   - Old `schemaVersion: 1`, `topology`, `protocol` file does not load.
   - Diagnostic tells users `schemaVersion: 2` is required.

5. **Missing schema is rejected**
   - Team files without `schemaVersion: 2` do not load.

6. **No topology fallback**
   - File with `topology: "pair"` but no `protocol`/`engine` is invalid.
   - Error says protocol/engine is required after schema is fixed.

7. **Graph does not get forced into deprecated fallback**
   - v2 graph team with edges loads and dispatches as graph.
   - No chain/pair/council fallback is required for execution.

### Handler tests

8. **Handlers match by protocol**
   - Construct normalized teams with no topology and assert:
     - `consult` → consult handler
     - `pair-coding` → pair-coding handler
     - `debate` → debate handler
     - `telephone` → telephone handler
     - `graph`/edges → graph handler

9. **Adapters validate by protocol**
   - `teamToCouncilDefinition` accepts `protocol: "debate"` without relying on topology.
   - `teamToPairDefinition` accepts `protocol: "consult"` / `pair-coding"` without relying on topology.

10. **Model slots by protocol**
   - `modelSlotsForTeam` works when `topology` is absent/deprecated.

### Tool/UI tests

11. **`team_list` protocol-primary details**
   - Text contains `protocol` display.
   - Details preserve deprecated topology only as compatibility metadata if present.

12. **`team_describe` protocol-primary output**
   - Shows `Protocol: consult`.
   - Does not lead with `Topology`.
   - Includes deprecations separately from invalid warnings.

13. **`team_form` writes v2**
   - Created team file contains `schemaVersion: 2`.
   - Contains `protocol`.
   - Does not contain `topology`.

14. **`team_models` migrates write output**
   - Updating models for a v1 copied built-in writes a user/project v2 override.
   - Existing source file is not mutated unless it is the target override.

### P2 contract regression tests

15. **Prompt defaults selected by protocol**
   - P2 resolver receives protocol slots only.
   - No prompt fallback path checks topology.

16. **Copied built-in prompt aliases preserved**
   - Old copied default-debate with existing prompt ids/settings aliases resolves same effective prompt chain.

---

## Acceptance criteria

- Authored v2 teams load; v1/missing-schema teams are rejected.
- Built-ins are v2 and omit `topology`.
- Existing copied built-ins require migration to v2.
- `topology` is not used for dispatch, validation, prompt fallback, or handler selection.
- Missing protocol/engine is invalid even if topology is present.
- `team_form` no longer exposes topology as a normal authoring choice.
- `team_describe` and Team Detail are protocol-primary.
- Tests cover v2 authoring, engine aliasing, mismatch rejection, v1 rejection, and no-topology fallback.
- Validate with:

```bash
npm run check
npm test
```
