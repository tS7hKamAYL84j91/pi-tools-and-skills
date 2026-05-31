# Teams Protocol Review — Anthropic Effective Agents Guidance

Date: 2026-05-31
Status: active
Goal: `g-f90275d0-0733-4663-99c1-63a88d575d51`
Source reviewed: <https://www.anthropic.com/engineering/building-effective-agents>

## Executive summary

Anthropic's guidance supports the current Panopticon Teams direction: keep protocols simple, explicit, and workflow-shaped rather than rebuilding a generic autonomous-agent framework. The useful changes are documentation and prompt/tool ergonomics, not architecture expansion.

Recommendation: **refine Teams docs and skill guidance; do not add runtime framework surface.**

## Relevant findings from Anthropic

1. Prefer predictable **workflows** for known tasks; reserve open-ended agents for ambiguous work.
2. Start with the simplest pattern that can work; add complexity only when evaluation shows benefit.
3. Common effective patterns are:
   - prompt chaining
   - routing
   - parallelization
   - orchestrator-workers
   - evaluator-optimizer
4. Tool and agent-computer interface design matter: names, parameters, examples, and boundaries should make correct use obvious.
5. Avoid framework overhead when direct composition is enough.

## Mapping to current Teams protocols

| Anthropic pattern | Current Teams protocol/surface | Disposition |
|---|---|---|
| Routing | `team_run` with `navigator`, `llm-council`, `deep-research` | Keep; make selection guidance sharper. |
| Prompt chaining | Direct protocol handlers and staged team execution | Keep direct handlers. |
| Parallelization | `llm-council` debate members | Keep; no generic graph needed. |
| Orchestrator-workers | Team runner/member calls; deep-research role split | Keep bounded. |
| Evaluator-optimizer | `deep-research` Explorer → Verifier → Synthesis feedback loop | Keep only where evidence loops matter. |
| Autonomous agent | Spawned/peer agents outside Teams protocol core | Do not make default Teams behavior agentic. |

## Recommended changes

### 1. Fold guidance into `pi-team-consultation` skill and Teams README

Add compact guidance that says:

- choose the simplest team that can succeed;
- use `navigator` for focused bounded review;
- use `llm-council` for architecture, public API, persistence, security, and contested tradeoffs;
- use `deep-research` only when evidence gathering and verification loops are needed;
- avoid raw logs, private transcripts, and large pasted context.

### 2. Document protocol-to-pattern mapping

Add a small table to `extensions/pi-panopticon/teams/README.md` mapping:

- `navigator` → routing + focused evaluator
- `llm-council` → parallelization + synthesis
- `deep-research` → orchestrator-workers + evaluator-optimizer

This makes the protocol intent clear without adding a new abstraction layer.

### 3. Tighten `team_run` and built-in team descriptions

Improve descriptions toward agent-computer-interface clarity:

- emphasize `id` as the team/protocol route;
- tell callers to choose the smallest sufficient team;
- state when `async: true` is preferred;
- include concise examples in docs/skill guidance rather than reintroducing deleted SOP templates.

### 4. Keep removed templates removed

The deleted `docs/templates/pi-teams-recurring-workflows.md` should stay removed unless its content is folded into the Teams skill/README. Parallel static SOPs are likely to drift from runtime behavior and skill guidance.

### 5. Avoid a DAG/framework layer

Do not reintroduce generic graph execution, topology lowering, or template engines unless a concrete workflow fails with direct protocol handlers and the need is proven by tests/evaluation.

## Non-goals

- No new team protocol.
- No runtime scheduler.
- No mandatory approval gate.
- No public observability/checkpoint contract.
- No generic DAG or workflow engine.
- No resurrection of standalone `pi-teams` extension boundaries.

## Acceptance criteria

- `pi-team-consultation` contains the simplified routing guidance and Anthropic-pattern rationale.
- `extensions/pi-panopticon/teams/README.md` documents protocol-to-pattern mapping.
- Built-in team/tool documentation nudges callers toward the simplest sufficient team.
- Deleted templates remain absent and unreferenced.
- No generic framework files, APIs, or public schemas are introduced.

## Suggested validation

- `rg -n "pi-teams-recurring-workflows|docs/templates|templates/" docs extensions skills tests README.md package.json` returns no stale references.
- `npm run check`
- `npm test`

## Final recommendation

Proceed with small documentation/skill refinements only. The current direct-handler Teams architecture already matches the article's strongest recommendation: simple, composable workflows over complex agent frameworks.
