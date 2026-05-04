# P1 Review Checklist: Execution Config Propagation

Prepared while Jules session `16658974696077478963` works on P1.

## High-risk files

- `extensions/pi-teams/runner.ts`
  - Preserve omitted tools vs `tools: []`.
  - Omitted tools should not become `--no-tools`.
  - Child `pi --print` should sanitize empty tool payloads when needed.
- `extensions/pi-teams/team-registry.ts`
  - Parse and merge subagent manifest config vs team role binding config.
  - Keep `tools: []` as explicit no-tools.
- `extensions/pi-teams/team-handlers.ts`
  - Dispatch config for debate, pair, telephone, and graph handlers.
  - Avoid index mismatches when runtime model overrides change member counts.
- `extensions/pi-teams/deliberation.ts`
  - Propagate council generation, critique, and synthesis config.
  - Define whether critique uses critic-binding config or generation-member config.
- `extensions/pi-teams/pair-coding.ts`
  - Support phase-specific driver/navigator config for brief, implementation, review, and fix.
- `extensions/pi-teams/team-graph.ts`
  - Propagate per-node config and reject/document unsupported live-agent refs.
- `extensions/pi-teams/team-tools.ts` and `extensions/pi-teams/team-overlay.ts`
  - Display effective tools/parameters without noise or duplicated model lines.
- `extensions/pi-teams/provider-payload.ts`, `provider-overrides-extension.ts`, and `index.ts`
  - Do not regress P0 provider-aware parameter filtering or empty-tool sanitization.
- `tests/council-teams.test.ts` and `tests/council-provider-payload.test.ts`
  - Expected expansion/conflict points.

## Required edge cases

### Precedence

- Runtime model override wins over team model binding.
- Team role binding `tools` wins over subagent manifest `tools`.
- Team role binding `parameters` wins over subagent manifest `parameters`.
- Omitted binding config inherits manifest config.
- Explicit `tools: []` overrides manifest config.
- Document whether `parameters` precedence is field-level merge or whole-object replacement, and test that behavior.

### Omitted tools vs empty tools

- Omitted `tools` = runner/provider default.
- `tools: []` = no tools.
- `tools: ["read"]` = only those tools.
- Runner CLI behavior:
  - omitted tools: no `--tools` and no `--no-tools`,
  - empty tools: `--no-tools`,
  - non-empty tools: `--tools read,bash`.
- Provider payload sanitizer prevents rejected `tools: []` payloads for one-shot child calls, not only parent extension sessions.

### Council protocol

- Generation members receive effective config per member binding.
- Chairman synthesis receives chairman binding/manifest config.
- Critique-phase semantics are explicit and tested.
- Runtime `team_run.models.members` override does not misalign member configs by index without a documented rule.
- Extra/fewer runtime members than configured bindings are handled deterministically.

### Pair protocols

- `pair-coding` does not use one generic driver config for both implementation and fix if separate bindings exist.
- `pair-coding` does not use one generic navigator config for both brief and review if separate bindings exist.
- `consult` model navigator receives effective navigator config.
- `consult` live-agent navigator rejects or warns when tools/parameters are configured but unenforceable.
- `pair-coding` continues rejecting `agent:` refs for driver/navigator unless intentionally changed.

### Telephone protocol

- Relay config follows relay binding order.
- Duplicate subagent ids in multiple relay bindings do not collapse hops.
- Missing relay model fallback keeps config mapped to the intended hop.
- Each relay receives its own tools/parameters.

### Graph protocol

- Every graph node receives effective config from its binding/subagent.
- `tools: []` on one node does not affect another node.
- Node model fallback from `team.models.members[0]` does not lose node config.
- `agent:` refs are rejected or documented as unsupported unless implemented.
- Cycle/unknown-edge validation still runs before launching child calls.

### Live-agent refs

- Council `agent:<name>` members/chairmen do not silently pretend parent-side tools/parameters are enforceable.
- Pair-consult `agent:<name>` navigator has the same explicit limitation.
- Graph/telephone reject `agent:` refs or implement live-agent routing.
- `team_describe` marks unenforceable config on live-agent roles as a warning/limitation.

## Likely conflicts with current local P0 patch

- `extensions/pi-teams/config/agents/*.md`: P1 must not reintroduce bundled `parameters.temperature`.
- `extensions/pi-teams/team-form.ts`: generated stubs must remain portable and temperature-free.
- `extensions/pi-teams/provider-payload.ts`: P1 must not restore arbitrary root-level parameter injection for unknown payload shapes.
- `extensions/pi-teams/provider-overrides-extension.ts`: tools propagation may need hooks loaded even when only `tools: []` is present.
- `extensions/pi-teams/index.ts`: parent `before_provider_request` hooks do not automatically cover child `pi --print` calls.
- `tests/council-provider-payload.test.ts`: likely merge-conflict point if P1 adds provider/tool tests there.
- `docs/archive/teams-future-improvements-progress-log.md`: high merge-conflict risk if Jules updates P1 text.
