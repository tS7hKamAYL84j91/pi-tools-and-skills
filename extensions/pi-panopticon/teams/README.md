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
| `team_run` | Run a team by `id`; choose the smallest sufficient route such as `navigator`, `llm-council`, or `deep-research`. |
| `runtime_status` | Inspect team run entities from the unified runtime surface, including aggregate status/artifact counts. |
| `runtime_stop` | Stop a team run entity through unified runtime semantics. |
| `team_runs` | Inspect active/recent team run state, including aggregate status/artifact counts. |
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

Choose the simplest protocol that can succeed. Use `async: true` for non-blocking reviews or long research runs; use synchronous `team_run` only when the next step depends on the answer.

| Built-in team | Protocol pattern | Use when |
|---|---|---|
| `navigator` | Routing + focused evaluator | One bounded reviewer can check correctness, scope, tests, or docs. |
| `llm-council` | Parallelization + synthesis | Architecture, public API, persistence, security, or contested tradeoffs need explicit disagreement. |
| `deep-research` | Orchestrator-workers + evaluator-optimizer | Evidence gathering and verification loops are required before synthesis. |

- `navigator` — lightweight review and decision support.
- `debate` — multi-member council with synthesis.
- `research` — bounded Explorer/Verifier/Synthesis loop for evidence-audited reports.

Team specs live under `extensions/pi-panopticon/teams/config/` and may be overridden by user/project team files. Runtime state is persisted through pi session custom entries and reflected in a compact `teams:` status field. Team runs are exposed as `team_run` runtime entities via `runtime_status`/`runtime_stop`; peer agent health remains visible through Panopticon's `agent_status`.

## What this does NOT do

- Does not replace normal model/tool execution for simple tasks.
- Does not own provider credentials or add model providers; it uses the active pi model registry.
- Does not force dynamic graph execution for every workflow; protocols are direct and intentionally restrained.
- Does not provide a generic DAG, topology lowering layer, scheduler, or template engine.
- Does not make deep-research provider calls itself; research tool availability is provided by registered tools such as `pi-research-tools`.
- Does not guarantee that every team member is available; unavailable models or live agents remain validation/runtime concerns.
