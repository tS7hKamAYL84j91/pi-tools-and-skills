# Pi Teams Extension

Standalone declarative team workflows for lightweight review, council-style debate, and deep-research pipelines. Install `extensions/pi-teams` independently alongside any other pi extensions.

## Installation

```bash
pi install /absolute/path/to/extensions/pi-teams
# or from this repository:
make setup-package PACKAGE=pi-teams
```

The package manifest loads `index.ts` and the bundled `pi-team-consultation` skill. It owns the `team_*` tools and `/teams` command described below; no other extension needs to register them.

## Stable Tools/Commands

### Agent interface (tools)

These tools are the agent-facing compatibility interface and are registered by `pi-teams`:

| Tool | Purpose |
| --- | --- |
| `team_list` | List available built-in, user, and project teams. |
| `team_describe` | Show one team's manifest and agents. |
| `team_form` | Create or replace a declarative team. |
| `team_models` | Update model bindings for a team. |
| `team_delete` | Delete a user/project team. |
| `team_run` | Run a team by `id` with optional `profile: fast | balanced | thorough`; choose the smallest sufficient route. |
| `team_runs` | Inspect session-backed runs; optional `runId` selects one run. Includes aggregate status/artifact counts. |
| `team_stop` | Stop an active run; optional `runId` defaults to the newest pending/running run. Terminal runs are rejected without changing history. |

### Commands

- `/teams` — browse configured teams; press `r` on the selected team, choose `fast`, `balanced`, or `thorough` in the native profile picker, then enter the one-shot prompt.
- `/teams run [id] [prompt] [--profile fast|balanced|thorough]` — run synchronously (default profile: `balanced`). The option may appear before or after the prompt and also accepts `--profile=<value>`; use `--` before literal prompt text containing `--profile`.
- `/teams async [id] [prompt] [--profile fast|balanced|thorough]` — start the same profiled run asynchronously and deliver its result as a follow-up.
- `/teams seed [--force]` — project built-in team seeds into the user scope (`~/.pi/agent/teams`). Idempotent and never overwrites existing user files; `--force` overwrites user-scope copies of built-in ids (with confirmation).
- `/teams status [runId]` — inspect the same state exposed by `team_runs`.
- `/teams stop [runId]` — request cancellation of an explicit run, or the newest pending/running run when omitted.

The canonical execution interface is **run → status → stop**: `team_run` / `team_runs` / `team_stop` for agents, `/teams run|async|status|stop` for humans. `/teams` still browses team definitions. The `/team` interaction modes, implicit run shorthand, typo aliases, and `runtime_status`/`runtime_stop` tools are removed, not forwarded through compatibility wrappers. Ordinary prompts are never automatically routed into a team.

## Provisional Surfaces

- `research` protocol loop termination logic.
- Model binding overrides per team.

## Module Dependencies

- Uses shared agent-registry, maildir, and child-process utilities. Team lifecycle state is owned solely by `TeamStateManager`, with status views derived from its session events.
- Can utilize `pi-research-tools` if deep-research is invoked.

## Protocols

`pi-teams` supports three bounded protocols: `consult` (`navigator`), `debate` (`llm-council`), and `research` (`deep-research`). Work directly and self-check first; teams are optional assistance, not approval steps. Use the smallest sufficient team only when independent input materially helps or the user requests it. Use `async: true` when work can continue; use synchronous `team_run` when the next step depends on the answer. Explicit safety and permission gates still apply.

### Profiles and precedence

`team_run` and `/teams run|async` share three profiles: `fast` minimizes calls, context, retries, and output; `balanced` is the default bounded behavior; `thorough` allows deeper bounded output/context. Resolution order is **explicit `team_run` models/limits → profile defaults → team manifest/settings defaults**, followed by protocol safety caps. Navigator output remains direct.

Canonical profile output caps are translated at the provider payload boundary: Google GenerateContent and Cloud Code Assist use `maxOutputTokens`, OpenAI Responses uses `max_output_tokens`, and message-based OpenAI-compatible payloads use `max_tokens`. Unrecognized payload shapes are left unchanged rather than receiving `maxTokens` blindly.

Fast Navigator uses a compact prompt, no retries, a 30-second maximum node timeout, and bounded output. Explicit Fast timeout values can lower but not raise that safety cap.

Deterministic profile evaluation runs in normal CI from `tests/evals/fixtures/team-speed-profiles.json`; it verifies contracts and makes no live performance claim. Live provider timing is explicitly opt-in via `PI_TEAM_LIVE_BENCHMARK=1 npm run benchmark:teams:live -- ...` and records redacted end-to-end/per-node durations outside CI. See [`tests/evals/team-speed-profile-evaluation.md`](../../../tests/evals/team-speed-profile-evaluation.md) for baseline fields, median/P95 comparison, and promotion gates. **Balanced remains the default until Navigator live gates pass.**

| Built-in team | Protocol pattern | Use when |
| --- | --- | --- |
| `navigator` | Routing + focused evaluator | One bounded reviewer can check correctness, scope, tests, or docs. |
| `llm-council` | Parallelization + synthesis | Exceptional unresolved tradeoffs benefit from multiple views, or the user explicitly requests council. |
| `deep-research` | Orchestrator-workers + evaluator-optimizer | Evidence gathering and verification loops are required before synthesis. |

Team requests use the explicitly supplied prompt; removed interaction modes no longer copy session history into requests. Existing model bindings, routing choices and profile defaults are unchanged.

## Configuration

Team specs live under `extensions/pi-teams/config/` as immutable packaged seeds. On `session_start(startup)` they are projected verbatim into the user team directory (`~/.pi/agent/teams` by default, or the configured `teams.roots` user root) so the live copy is the editable source of truth for each team; existing user/project files are never overwritten. Unavailable pinned models fail loudly and actionably — the system does not silently substitute models. Runtime state is persisted through pi session custom entries. Each active run owns a compact `team:<runId>` progress widget, refreshed by transient in-memory state subscriptions rather than polling; subscriptions themselves are never persisted. Run/status/stop, progress widgets and restored session views all use `TeamStateManager`; there is no parallel runtime entity registry.

## What this does NOT do

- Does not replace normal model/tool execution for simple tasks.
- Does not own provider credentials or add model providers; it uses the active pi model registry.
- Does not intercept ordinary prompts or enable automatic team interaction modes.
- Does not force dynamic graph execution for every workflow; protocols are direct and intentionally restrained.
- Does not provide a generic DAG, topology lowering layer, scheduler, or template engine.
- Does not make deep-research provider calls itself; research tool availability is provided by registered tools such as `pi-research-tools`.
- Does not guarantee that every team member is available; unavailable models or live agents remain validation/runtime concerns.
