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
| `team_run` | Run a team by `id` with optional `profile: fast | balanced | thorough`; choose the smallest sufficient route. |
| `runtime_status` | Inspect team run entities from the unified runtime surface, including aggregate status/artifact counts. |
| `runtime_stop` | Stop a team run entity through unified runtime semantics. |
| `team_runs` | Inspect active/recent team run state, including aggregate status/artifact counts. |
| `team_stop` | Compatibility team-run stop surface; same stop semantics as `runtime_stop`. |

### Commands

- `/teams` — browse and run configured teams from the TUI.
- `/teams seed [--force]` — project built-in team seeds into the user scope (`~/.pi/agent/teams`). Idempotent and never overwrites existing user files; `--force` overwrites user-scope copies of built-in ids (with confirmation).
- `/team on|auto|off|status|once [prompt] [--topology fusion-analysis|llm-council|navigator] [--profile fast|balanced|thorough] [--max-models 1-5]` — session-only team interaction mode. `on` is deterministic, `auto` is assistant-mediated, and `once <prompt>` runs immediately. Defaults to `fusion-analysis` and `balanced`.

## Provisional Surfaces

- `research` protocol loop termination logic.
- Model binding overrides per team.

## Module Dependencies

- Uses Panopticon runtime, live-agent, and message-routing substrate through internal module boundaries.
- Can utilize `pi-research-tools` if deep-research is invoked.

## Protocols

Choose the simplest protocol that can succeed. Use `async: true` for non-blocking reviews or long research runs; use synchronous `team_run` only when the next step depends on the answer.

### Profiles and precedence

`team_run` and `/team` share three profiles: `fast` minimizes calls, context, retries, and output; `balanced` is the default bounded behavior; `thorough` allows deeper bounded output/context. Resolution order is **explicit `team_run` models/limits → profile defaults → team manifest/settings defaults**, followed by protocol safety caps. Fusion's legacy explicit `limits.maxLoops` remains a supported panel-size override and wins over the profile panel default. Fast Fusion prefers provider-diverse models from the configured order, bounds panel/judge output and judge input, and returns complete JSON with `answer`, `consensus`, `contradictions`, `partialCoverage`, `uniqueInsights`, `blindSpots`, `confidence`, and `missingEvidence`. Invalid judge JSON still produces a degraded structured fallback.

Fast Navigator uses a compact prompt, no retries, a 30-second maximum node timeout, and bounded output. Explicit Fast timeout values can lower but not raise that safety cap.

| Built-in team | Protocol pattern | Use when |
|---|---|---|
| `navigator` | Routing + focused evaluator | One bounded reviewer can check correctness, scope, tests, or docs. |
| `llm-council` | Parallelization + synthesis | Architecture, public API, persistence, security, or contested tradeoffs need explicit disagreement. |
| `deep-research` | Orchestrator-workers + evaluator-optimizer | Evidence gathering and verification loops are required before synthesis. |
| `fusion-analysis` | Bounded panel + judge (analysis only) | OpenRouter-style deliberation: the team returns structured JSON analysis and the caller synthesizes the final answer. |

### `/team on` / `/team once` context enrichment

Deterministic `balanced` team runs prepend at most the last five user/assistant text turns and 4,000 history characters. `fast` sends only the current prompt; `thorough` permits at most eight turns and 8,000 characters. Turns are truncated oldest-first, non-user/assistant content is skipped, and likely secrets are redacted. Context assembly remains isolated in `buildTeamContext`.

## Configuration

Team specs live under `extensions/pi-panopticon/teams/config/` as immutable packaged seeds. On `session_start(startup)` they are projected verbatim into the user team directory (`~/.pi/agent/teams` by default, or the configured `teams.roots` user root) so the live copy is the editable source of truth for each team; existing user/project files are never overwritten. Unavailable pinned models fail loudly and actionably — the system does not silently substitute models. See ADR 026. Runtime state is persisted through pi session custom entries and reflected in a compact `teams:` status field. Team runs are exposed as `team_run` runtime entities via `runtime_status`/`runtime_stop`; peer agent health remains visible through Panopticon's `agent_status`.

## What this does NOT do

- Does not replace normal model/tool execution for simple tasks.
- Does not own provider credentials or add model providers; it uses the active pi model registry.
- Does not persist `/team` interaction mode across sessions or turn it on by default.
- Does not force dynamic graph execution for every workflow; protocols are direct and intentionally restrained.
- Does not provide a generic DAG, topology lowering layer, scheduler, or template engine.
- Does not make deep-research provider calls itself; research tool availability is provided by registered tools such as `pi-research-tools`.
- Does not guarantee that every team member is available; unavailable models or live agents remain validation/runtime concerns.
