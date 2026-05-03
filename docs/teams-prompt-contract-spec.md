# P2 Mini-Spec: Explicit Team / Prompt / Subagent Contract

## Goal

Make prompt behavior inspectable and explicit without collapsing distinct concepts:

- **Subagent prompt/system prompt = who the role is.**
- **Team spec = which roles participate, which models/subagents fill them, and which prompt slots are overridden.**
- **Protocol templates = how dynamic runtime data is packaged between phases.**
- **Team markdown body/notes = human documentation only, not injected into model calls.**

Prompts are separate because role identity, team wiring, and protocol handoff packaging change independently.

## Schema additions

Use a shallow `prompts` map in team front matter so it works with the current limited front-matter parser.

```yaml
prompts:
  synthesis.template: "strict-synthesis-template"
  critique.template: "risk-weighted-critique-template"
```

Definitions:

- **Prompt slot:** protocol-defined string key for a semantic location, e.g. `synthesis.template`.
- **Prompt id:** markdown prompt asset id to load for that slot.
- **Protocol defaults:** data loaded from protocol/prompt assets, not a TypeScript union of known team types.

Add types:

```ts
export type PromptSlotId = string;
export type PromptAssetId = string;
export type TeamPromptRefs = Record<PromptSlotId, PromptAssetId>;
```

Do **not** encode built-in workflows such as council, pair, telephone, or graph as TypeScript prompt-slot union members. The extension should not need a code change to add a new protocol or test workflow.

Add to `TeamSpec`:

```ts
prompts: TeamPromptRefs;
```

Extend `TeamAgentBinding`:

```ts
promptId?: string;
templateId?: string;
systemPrompt?: string;
```

Notes:

- `promptId` overrides the system prompt for that binding's phase/role.
- `templateId` overrides the template for that binding's phase/role.
- `systemPrompt` is an inline literal escape hatch and highest precedence for system text.
- Subagent manifests keep existing `promptId` and markdown body behavior.

## Resolution precedence

Resolve **system prompts** and **templates** separately.

### System prompt precedence, lowest to highest

1. Protocol default system slot.
2. Subagent default:
   - subagent `promptId`, or
   - subagent markdown body when no `promptId` exists.
3. Team override: `team.prompts[slot]`.
4. Binding override: `binding.promptId`.
5. Binding literal override: `binding.systemPrompt`.

### Template precedence, lowest to highest

1. Protocol default template slot.
2. Team override: `team.prompts[slot]`.
3. Binding override: `binding.templateId`.

Subagents do **not** own protocol templates. They define role identity; templates package runtime data like peer answers, critiques, context, artifacts, graph inputs, and relay content.

## Protocol phase slot mapping

Slot mapping is protocol data, not code. Each protocol definition declares the slots it needs:

```ts
export interface ProtocolPromptSlot {
	id: PromptSlotId;
	kind: "system" | "template";
	required: boolean;
	defaultPromptId?: PromptAssetId;
}

export interface ProtocolPromptContract {
	protocol: string;
	slots: ProtocolPromptSlot[];
}
```

Handlers ask the resolver for slots by string id supplied by the protocol contract. Built-in protocol contracts may ship with the extension, but the TypeScript schema stays open.

For debate-like workflows, a `critic` binding can still be meaningful: it supplies the critique phase role contract, while the reviewer model can remain the successful generation member model. That is a built-in protocol behavior, not a generic `TeamPromptSlot` type member.

## Concrete `default-council` example

```yaml
---
schemaVersion: 2
id: "default-council"
name: "Default Council"
description: "General high-stakes reasoning and architecture review."
protocol: "debate"

prompts:
  generation.system: "council-generation-system"
  critique.system: "council-critique-system"
  critique.template: "council-critique-template"
  synthesis.template: "strict-council-synthesis-template"

agents:
  - role: "member"
    subagent: "council_generation_member"
    model: "openai-codex/gpt-5.5"
    label: "Member 1"

  - role: "member"
    subagent: "council_generation_member"
    model: "google-gemini-cli/gemini-3.1-pro-preview"
    label: "Member 2"

  - role: "critic"
    subagent: "council_critic"
    templateId: "riskWeightedCritiqueTemplate"

  - role: "chairman"
    subagent: "council_chairman"
    model: "openai-codex/gpt-5.5"
---
Human notes only. This body is not injected into model calls.
```

Effective chain examples:

- Generation system: protocol default slot `generation.system` → subagent `council_generation_member.promptId` → no team/binding override → effective prompt asset.
- Critique template: protocol default slot `critique.template` → team default/override → critic binding override `risk-weighted-critique-template` → effective prompt asset.
- Synthesis template: protocol default slot `synthesis.template` → team override `strict-council-synthesis-template` → no chairman binding override → effective prompt asset.

## Implementation touch points

- `extensions/pi-teams/config`
  - Optionally add `prompts:` maps to built-in team files for inspectability.
  - Keep existing prompt files as default ids/aliases.
  - Add fixture prompt files for override tests.
- `extensions/pi-teams/team-types.ts`
  - Add open string prompt refs (`PromptSlotId`, `PromptAssetId`, `TeamPromptRefs`), `TeamSpec.prompts`, `TeamAgentBinding.promptId`, and `TeamAgentBinding.templateId`.
- `extensions/pi-teams/team-registry.ts`
  - Parse shallow `prompts` objects from team front matter.
  - Parse binding `promptId`, `templateId`, `systemPrompt`.
  - Preserve default inheritance when `prompts` is absent.
  - Avoid losing provenance by blindly merging subagent `systemPrompt` into bindings.
- `extensions/pi-teams/prompts.ts`
  - Move debate prompt selection behind resolver calls.
  - Keep wrapper functions as compatibility helpers where useful.
- `extensions/pi-teams/pair-prompts.ts`
  - Move pair prompt selection behind resolver calls.
  - Keep template render variable names unchanged.
- `extensions/pi-teams/team-handlers.ts`
  - Resolve effective prompt chains before dispatch.
  - Pass critique role binding into debate critique phase.
  - Pass phase-specific prompt/template refs into protocol execution without hardcoding test workflow names in shared types.
- `extensions/pi-teams/settings.ts`
  - Support custom prompt ids if prompt overrides should load arbitrary prompt files; current prompt-key typing is fixed.
- `extensions/pi-teams/team-tools.ts` and `team-overlay.ts`
  - Show effective prompt chains in `team_describe` and Team Detail.

## Tests

Minimum coverage:

1. Existing built-in teams load with no `prompts` section and effective prompt ids equal current defaults.
2. A team override for a protocol-defined slot such as `synthesis.template` leaves other slots inherited.
3. A `critic` binding with `templateId` overrides the team/default critique template.
4. System precedence: protocol default < subagent `promptId` < team prompt override < binding `promptId` < binding `systemPrompt`.
5. Template precedence: protocol default < team override < binding `templateId`.
6. Subagent `promptId` resolves at runtime; subagent markdown body is fallback only when no `promptId` exists.
7. `team_describe default-council` includes member, critic, and chairman prompt/template chains.
8. Unknown prompt id fails clearly before launching partial child model calls.
9. Built-in and fixture protocol handlers call resolver-selected prompt/template ids rather than hardcoded settings keys.
