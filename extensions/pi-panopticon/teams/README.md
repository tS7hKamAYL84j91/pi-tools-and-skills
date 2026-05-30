# Panopticon Teams Module

Declarative team workflows for lightweight review, council-style debate, and deep-research pipelines. This is a modular submodule of the `pi-panopticon` extension, not a separately installable extension.

## Stable Tools/Commands

### Tools

| Tool | Purpose |
|---|---|
| `team_list` | List available built-in, user, and project teams. |
| `team_describe` | Show one team's manifest and agents. |
| `team_form` | Create or replace a declarative team. |
| `team_models` | Update model bindings for a team. |
| `team_delete` | Delete a user/project team. |
| `team_run` | Run a team protocol such as navigator, debate, or research. |
| `runtime_status` | Inspect team run entities from the unified runtime surface. |
| `runtime_stop` | Stop a team run entity through unified runtime semantics. |
| `team_runs` | Inspect active/recent team run state. |
| `team_stop` | Compatibility team-run stop surface; same stop semantics as `runtime_stop`. |

### Commands

- `/teams` — browse and run configured teams from the TUI.

## Provisional Surfaces

- `research` protocol loop termination logic.
- Model binding overrides per team.

## Module Dependencies

- Uses Panopticon runtime, live-agent, and message-routing substrate through internal module boundaries.
- Can utilize `pi-research-tools` if deep-research is invoked.

## Protocols

- `navigator` — lightweight review and decision support.
- `debate` — multi-member council with synthesis.
- `research` — bounded Explorer/Verifier/Synthesis loop for evidence-audited reports.

Team specs live under `extensions/pi-panopticon/teams/config/` and may be overridden by user/project team files. Runtime state is persisted through pi session custom entries and reflected in a compact `teams:` status field. Team runs are exposed as `team_run` runtime entities via `runtime_status`/`runtime_stop`; peer agent health remains visible through Panopticon's `agent_status`.

## Recurring workflow SOPs

Static, copyable SOP templates for recurring architecture/code review and research synthesis workflows live in `docs/templates/pi-teams-recurring-workflows.md`. They are guidance only and do not change team runtime behavior.

## What this does NOT do

- Does not replace normal model/tool execution for simple tasks.
- Does not own provider credentials or add model providers; it uses the active pi model registry.
- Does not force dynamic graph execution for every workflow; protocols are direct and intentionally restrained.
- Does not make deep-research provider calls itself; research tool availability is provided by registered tools such as `pi-research-tools`.
- Does not guarantee that every team member is available; unavailable models or live agents remain validation/runtime concerns.
