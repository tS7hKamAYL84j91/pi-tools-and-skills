# Council and Pair Prompt Review

Status: superseded by teams migration  
Date: 2026-05-02  
Scope: `extensions/pi-teams/config/`

## Current state

The council extension now uses a teams/subagents structure:

- `config/agents/` — role/system prompts.
- `config/teams/` — declarative team specs.
- `config/prompts/` — reusable templates, framing, and primer text.

The old public council/pair surface has been removed:

- `ask_council`
- `council_form`
- `council_update`
- `council_list`
- `council_dissolve`
- `pair_list`
- `pair_consult`
- old council/pair slash commands

The standard tools are now:

- `team_list`
- `team_describe`
- `team_run`

## Inventory

### Teams — 3

- `config/teams/default-debate.md`
- `config/teams/consult.md`
- `config/teams/pair-coding.md`

### Council prompts/subagents — 5

- `config/agents/council-generation-member.md`
- `config/agents/council-critic.md`
- `config/agents/council-chairman.md`
- `config/prompts/council-critique-template.md`
- `config/prompts/council-synthesis-template.md`

These map to the 3-stage council protocol:

1. independent generation;
2. peer critique;
3. chairman synthesis.

### Pair prompts/subagents — 10

- `config/prompts/pair-primer.md`
- `config/agents/pair-navigator-consult.md`
- `config/agents/pair-navigator-brief.md`
- `config/prompts/pair-navigator-brief-template.md`
- `config/agents/pair-driver-implementation.md`
- `config/prompts/pair-driver-implementation-template.md`
- `config/agents/pair-navigator-review.md`
- `config/prompts/pair-navigator-review-template.md`
- `config/agents/pair-driver-fix.md`
- `config/prompts/pair-driver-fix-template.md`

Pair workflows are now selected by team id:

- `consult` — lightweight Navigator review.
- `pair-coding` — bounded Driver/Navigator implementation pipeline.

### Live-agent prompts — 3

- `config/prompts/agent-council-framing.md`
- `config/prompts/agent-consult-framing.md`
- `config/prompts/agent-request-template.md`

These remain for live-agent team participants.

## Result

Council and pair are no longer separate public tool families. They are built-in teams backed by shared descriptor loading, validation, and `team_run` execution.
