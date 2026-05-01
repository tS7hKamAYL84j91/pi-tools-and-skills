# FIRE Tool-Surface Pruning Proposal

Status: proposal + delegation plan; implementation delegated where approved  
Date: 2026-05-01  
Scope: `pi-tools-and-skills` reusable extensions, tools, commands, and remaining skills

## FIRE Lens

Dan Ward's **FIRE** approach means **Fast, Inexpensive, Restrained, Elegant**.

For this repo, FIRE means:

- fewer default tools in model context;
- fewer overlapping verbs;
- less background state and operational magic;
- project/operator features live outside this reusable package;
- implementation should be delegated once the architecture decision is clear.

## Current Working Rule

Local agents act as **project manager / architect**:

- define scope, acceptance criteria, and review plan;
- delegate approved coding tasks to Jules;
- monitor work and review results;
- avoid becoming the hidden implementation team.

This rule is also captured in `AGENTS.md` so it becomes the default work mode.

## Decision Summary

### Approved for Jules delegation

- **Remove kanban monitor surface**
  - Remove/deprecate: `kanban_monitor`, `/monitor-reset`, `/monitor-pause`.
  - Reason: background-ish state and reconciliation noise.
  - Replacement: explicit `kanban_snapshot`.

- **Move Panopticon list-mode controls out of LLM tool surface**
  - Remove/demote: `set_agent_list_mode`.
  - Keep list-mode as TUI/human-only if useful.
  - Reason: display preference, not model capability.

- **Fold or remove `agent_nudge`**
  - Remove `agent_nudge` as a separate model-callable tool.
  - Preferred direction: extend or document `agent_send` as the ordinary urgent-message path.
  - Reason: concept overlaps with `agent_send`; too much special-purpose communication surface.

- **Simplify Kanban assignment verbs**
  - Consolidate: `kanban_pick`, `kanban_claim`, `kanban_reassign`.
  - Direction: one assignment/claim operation, preserving WIP limit and event-log clarity.
  - Reason: duplicate assignment verbs.

- **Fold `kanban_note` into edit/update path**
  - Direction: notes become a supported mode of `kanban_edit` or a new general update operation.
  - Constraint: preserve useful event semantics and snapshot display.

### Rejected / keep

- **Keep aliases**
  - Do not remove `get_alias`, `set_alias`, or `/alias` for now.
  - User uses this feature frequently.

- **Do not demote council from global default yet**
  - User uses the default council heavily.
  - Needs evidence before changing setup defaults.

### Needs more information before delegation

- **Council + pair unification**
  - Hypothesis: pair is a council of two with a Navigator role.
  - Need to understand whether `ask_council` can become the single method for both full council and pair review without making the common pair-review path worse.
  - Key question: what is the minimal API that preserves `pair_consult` ergonomics?

- **Cheatsheet authoring tools**
  - Candidate demotion: `mmem_create`, `mmem_update`, `mmem_validate`.
  - Need to know whether agent self-learning via `mmem_update` is important enough to keep model-callable.
  - Key question: should only `mmem_list`/`mmem_inject` be global, or is authoring part of the core memory loop?

- **Matrix ownership**
  - Current state: project-only/opt-in.
  - Need to know if there are non-CoAS consumers.
  - Key question: should Matrix stay generic here, or eventually move to CoAS?

- **Remaining pi-platform skills**
  - `skill-creator`, `pi-agent-orchestration`, and `pi-session-management` may overlap with docs/memories.
  - Need a content audit before trimming.

## Delegation Plan

### Jules Task A — Kanban FIRE simplification

Scope:

- `extensions/kanban/**`
- `tests/*kanban*`
- `docs/kanban-extension.md`
- `extensions/kanban/README.md`

Goals:

1. Remove/deprecate `kanban_monitor`, `/monitor-reset`, and `/monitor-pause`.
2. Consolidate assignment tools (`kanban_pick`, `kanban_claim`, `kanban_reassign`) into one simpler assignment/claim path.
3. Fold `kanban_note` into the edit/update path while preserving note events and snapshot visibility.
4. Update tests and docs.
5. Preserve board log compatibility where practical.

Acceptance criteria:

- `npm run check` passes.
- `npm test` passes.
- `git diff --check` passes.
- No removed kanban tool names remain registered.
- Existing board logs with old events still parse.

### Jules Task B — Panopticon FIRE surface trim

Scope:

- `extensions/pi-panopticon/**`
- `skills/pi-agent-orchestration/SKILL.md`
- `memories/pi-agent-orchestration.mmem.yml`
- related tests/docs

Goals:

1. Remove/demote `set_agent_list_mode` as an LLM tool.
2. Keep list-mode as TUI/human-only if the existing command/overlay remains valuable.
3. Remove or fold `agent_nudge` into the ordinary messaging path.
4. Update prompt snippets, skill guidance, memories, and tests.
5. Keep alias tools unchanged.

Acceptance criteria:

- `npm run check` passes.
- `npm test` passes.
- `git diff --check` passes.
- `get_alias`, `set_alias`, and `/alias` remain intact.
- No LLM-facing `set_agent_list_mode` tool remains.
- No separate `agent_nudge` model-callable tool remains unless Jules argues for a safer compatibility shim.

## Local PM / Architect Responsibilities

For each Jules result:

1. Pull or inspect the Jules patch without blindly applying.
2. Review for scope creep.
3. Run full local validation.
4. Use pair review before merging.
5. Use council review for architecture-affecting changes.
6. Commit/merge only after local review passes.

## Open Questions

1. Should `agent_send` gain an explicit `urgent` option, or is urgent wording enough?
2. What exact shape should the unified kanban assignment operation take?
3. Should `kanban_note` be folded into `kanban_edit`, or should there be a clearer `kanban_update` replacement?
4. Can `ask_council` subsume pair review without losing `pair_consult` simplicity?
5. Should cheatsheet authoring remain model-callable for agent learning?
6. Does Matrix have generic users outside CoAS?
