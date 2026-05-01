# Council and Pair Prompt Review

Status: review notes — no implementation yet  
Date: 2026-05-01  
Scope: `extensions/pi-llm-council/config/prompts/*.md`

## Summary

There are **18 prompt Markdown files** in the council extension:

- **Council debate:** 5 files
- **Pair workflow:** 10 files
- **Live-agent envelopes/framing:** 3 files

The surprise is mostly in the pair side. The pair feature contains two different concepts under one name:

1. **`pair_consult`** — the useful lightweight Navigator review path.
2. **Automated PAIR mode** — Driver/Navigator implementation pipeline: brief → implementation → review → fix.

The second concept explains most of the extra prompts and is the better candidate for simplification or removal.

## Inventory

### Council prompts — 5

- `council-generation-system.md`
- `council-critique-system.md`
- `council-chairman-system.md`
- `council-critique-template.md`
- `council-synthesis-template.md`

These map cleanly to the 3-stage council protocol:

1. independent generation;
2. peer critique;
3. chairman synthesis.

Assessment: reasonable. Not tiny, but conceptually coherent.

### Pair prompts — 10

- `pair-primer.md`
- `pair-navigator-consult-system.md`
- `pair-navigator-brief-system.md`
- `pair-navigator-brief-template.md`
- `pair-driver-implementation-system.md`
- `pair-driver-implementation-template.md`
- `pair-navigator-review-system.md`
- `pair-navigator-review-template.md`
- `pair-driver-fix-system.md`
- `pair-driver-fix-template.md`

Split by actual use:

- **Lightweight pair consultation:**
  - `pair-primer.md`
  - `pair-navigator-consult-system.md`

- **Automated pair coding pipeline:**
  - navigator brief system/template
  - driver implementation system/template
  - navigator review system/template
  - driver fix system/template

Assessment: `pair_consult` is useful; automated PAIR mode is the prompt explosion.

### Live-agent prompts — 3

- `agent-council-framing.md`
- `agent-pair-consult-framing.md`
- `agent-request-template.md`

These support live agent members rather than model-only members.

Assessment: small and separable. Keep if live-agent councils remain a supported feature.

## FIRE Assessment

### Keep

- Council prompts, unless/until the council protocol itself changes.
- `pair-primer.md` because it tells the Pilot when/how to consult the Navigator.
- `pair-navigator-consult-system.md` because it powers the common pair-review workflow.

### Question

- Automated PAIR mode prompts.

They are expensive in prompt surface and also conflict somewhat with the new default work mode:

> local agents act as project manager / architect; implementation should be delegated where practical.

A hidden Driver model writing code locally is the opposite direction unless we explicitly want that workflow.

## Recommended Direction

### P0 — gather usage/compatibility data

Before changing code, determine:

1. Do we actually use `/pair` or `ask_council(mode="PAIR")` for driver/navigator implementation?
2. Or do we mostly use `pair_consult` as a Navigator review tool?
3. Are any user settings overriding the individual pair prompt IDs?
4. Does any documentation recommend automated PAIR mode as the default coding path?

### P1 — if automated PAIR mode is unused

Remove or demote the automated Driver/Navigator implementation pipeline:

- `pairNavigatorBriefSystem`
- `pairNavigatorBriefTemplate`
- `pairDriverImplementationSystem`
- `pairDriverImplementationTemplate`
- `pairNavigatorReviewSystem`
- `pairNavigatorReviewTemplate`
- `pairDriverFixSystem`
- `pairDriverFixTemplate`

Keep:

- `pairPrimer`
- `pairNavigatorConsultSystem`
- `pair_list`
- `pair_consult`

This would reduce pair prompts from 10 to 2.

### P2 — if automated PAIR mode is still wanted

Consolidate prompt storage rather than deleting behavior:

- Keep one shared pair role/system prompt.
- Keep one stage template with `{{stage}}`, `{{context}}`, `{{prompt}}`, `{{artifact}}`, and `{{review}}` slots.
- Or group the stage prompts in a single visible Markdown config file instead of ten separate files.

This preserves override visibility while reducing file sprawl.

## Relationship to Council/Pair Unification

The user hypothesis is sound:

> pair is basically a council of two with a Navigator role.

Possible future shape:

- `ask_council` handles both debate and review modes.
- `pair_consult` remains as a convenience wrapper for the common Navigator review case.
- Internally, pair and council share a smaller prompt framework.

Do not remove `pair_consult` until the replacement is at least as ergonomic.

## Proposed Jules / Audit Task

This is not yet approved for implementation. A safe delegated task would be audit-only:

> Audit council/pair prompt usage and propose the smallest prompt set that preserves `pair_consult` and default council behavior. Do not remove prompts. Report which prompt IDs are used by which code paths and tests, and identify compatibility risks for user settings overrides.

## Recommendation

Do **not** start by editing prompt files.

First, confirm whether automated PAIR mode is actually used. If not, remove/demote that pipeline and keep the simple Navigator consultation path. That is the FIRE cut with the most leverage and least loss.
