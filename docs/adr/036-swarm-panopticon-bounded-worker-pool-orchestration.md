# ADR 036: /swarm — pi-panopticon bounded worker-pool orchestration

## Status

Proposed (design approved by llm-council; awaiting Principal sign-off before implementation)

## Context

Three recent Executive Office briefings converged on a single operational need:

- The agent-swarm economics post (Cursor, 2026-07-21) shows frontier-planner + cheap-worker hybrids can be ~8x cheaper than frontier-everywhere with similar quality.
- Adam Jacob's token-spend post (2026-07-22) argues orchestration should be deterministic code that minimizes the need for an LLM in the hot path.
- LoopGain (2026-07-22) is not directly applicable (our loops are gate-based), but it reinforces convergence-detection and best-so-far rollback principles we already encode via material-successor policy.

We already have the wiring: `spawn_agent`, `rpc_send`, `agent_status`, `agent_peek`, `kill_agent`, `team_run`, and `kanban_*`. What we lack is a deterministic, bounded, repo-local orchestration primitive a GM can invoke for a large decomposable task. The Principal directed that this primitive live as a **pi-panopticon package feature**, not a CoAS skill.

## Decision

Add a `/swarm` mode to `extensions/pi-panopticon/`.

`/swarm` is a deterministic, bounded, repo-local worker-pool orchestration feature invoked by a General Manager for large decomposable tasks. It decomposes the goal, spawns a WIP-limited pool of cheap local workers, monitors them, reconciles DONE/BLOCKED, runs stacked review gates, and only admits material successors with fresh provenance.

### Placement

`/swarm` lives as a new submodule in `extensions/pi-panopticon/swarm/`, alongside `spawner/`, `registry/`, and `teams/`.

It is **not** a team protocol (`teams/` protocols are fixed-shape review/debate/research panels) and **not** a skill (skills are LLM-read procedural guidance). It is a higher-level code primitive built on existing panopticon wiring.

### Files

- `extensions/pi-panopticon/swarm/swarm-types.ts`
- `extensions/pi-panopticon/swarm/swarm-planner.ts`
- `extensions/pi-panopticon/swarm/swarm-runner.ts`
- `extensions/pi-panopticon/swarm/swarm-reconciler.ts`
- `extensions/pi-panopticon/swarm/swarm-gates.ts`
- `extensions/pi-panopticon/swarm/swarm-commands.ts`
- `extensions/pi-panopticon/swarm/swarm-tools.ts`
- `extensions/pi-panopticon/swarm/index.ts`
- Wire into `extensions/pi-panopticon/index.ts`.

### Invocation surface

**Command:**

```text
/swarm <goal> [--profile fast|balanced|thorough] [--wip N] [--execute] [--async]
```

**Tool:**

```text
swarm_run goal="..." profile="balanced" wip=3 dry_run=true async=false
```

- `goal`: high-level outcome statement.
- `profile`: `fast` (minimal workers, navigator-only review), `balanced` (navigator + council for architecture), `thorough` (full stacked review).
- `wip`: max in-progress **swarm-claimed** workers. Default 3, hard cap 3.
- `dry_run`: default `true`. Return planned task tree and briefs without spawning. Spawning is opt-in (`dry_run=false` or `--execute`).
- `async`: default `false`. If `true`, return immediately with `swarmId` and deliver progress as follow-up messages.

### Lifecycle management

- `/swarm status <swarmId>` / `swarm_status(swarmId)` — show workers, kanban cards, reviews.
- `/swarm list` / `swarm_list()` — active/recent swarms.
- `/swarm cancel <swarmId>` / `swarm_stop(swarmId)` — abort: kill workers, block in-progress cards, record status.

These may be exposed as runtime entities so existing `runtime_status` / `runtime_stop` apply.

### Bounds and gates

| Bound | Value |
|---|---|
| Repo-local workers | `cwd` set to GM's repo root only. |
| WIP cap | 3 swarm-claimed in-progress cards, via per-swarm claim budget; global kanban WIP limit remains at its default (3). |
| Controlled topology | Planner decomposes once into a dependency-ordered task tree; no dynamic re-decomposition; workers never communicate peer-to-peer. |
| No blind retry | Failed task → `BLOCKED`; material successor only after review + fresh provenance. |
| Repair-loop bound | Max 3 repair cycles per task; exceeded → `BLOCKED` + GM notification. |
| Artifact gate | Each DONE worker produces a verifiable artifact (file, test result, diff) plus automated checkable evidence; review gates inspect evidence, not prose. |
| Parallel write isolation | Code-writing tasks are sequential or worktree-isolated; parallel workers restricted to read-only/scanning tasks. |
| Swarm-level ceiling | Wall-clock TTL (`fast`: 60 min, `balanced`: 120 min, `thorough`: 240 min) + worker-minutes soft cap. On breach: block in-progress cards, record partial evidence, status `blocked`. |
| Abort/teardown | On cancellation/shutdown/error: kill workers, block in-progress cards, status `aborted`. `session_shutdown` already calls `spawner.shutdownAll()`; swarm cleanup handles kanban + status. |
| Planner guard | If planner cannot decompose goal, return `blocked` with reason. |

### Kanban provenance

Each swarm card carries a `swarm:<swarmId>` tag. Worker briefs are stored in `pi-kanban/tasks/T-NNN.md` task files. The GM remains the sole kanban writer — all `kanban_*` calls flow through the GM's session, avoiding concurrent-write conflicts with Gravitas.

### Reuse of existing wiring

| Existing surface | Use in /swarm |
|---|---|
| `spawn_agent` / `rpc_send` | Spawn cheap workers with scoped briefs. |
| `agent_status` / `agent_peek` | Stall detection and progress monitoring. |
| `kill_agent` | Replace non-responsive workers and teardown. |
| `team_run` (navigator, llm-council, FIRE) | Stacked review gates. |
| `kanban_*` tools | Task tree state, WIP claim budget, DONE/BLOCKED tracking. |
| `coas_governance_resolve` / `maybeGovernanceRoute` (ADR-035) | Resolve cheap local models for worker prompts. `/swarm` is the first concrete caller of `maybeGovernanceRoute`. |
| CoAS ADR-0008 delivery guard (T-791) | Ensure OODA schedules don't hijack task-scoped swarm workers. |
| `pi-agent-orchestration` skill | Brief template, DONE/BLOCKED format, stall-nudge rules. |

### Non-decisions (out of v1)

- No new agent runtime, custom VCS, or emergent/dynamic topology.
- No swarm-scale failure machinery (split-brain/merge-conflict/megafile fixes are for ~1000 commits/sec; we are at human tempo).
- No `swarm_resume` interrupted-recovery feature.
- No concurrent multi-swarm semantics; v1 runs one swarm at a time per GM session.
- No per-token cost ceiling; TTL + worker-minutes cap cover v1.
- No replacement of kanban/STATE authority; Gravitas remains single-writer.

## Consequences

- GMs can invoke deterministic, bounded, auditable worker-pool orchestration for large tasks.
- Cheap local workers are selected via ADR-035 model-routing, realizing the ~8x economics.
- Stacked review gates and artifact evidence prevent blind retry and material-successor violations.
- CoAS ADR-0008 (T-791) prevents workspace schedules from hijacking swarm workers.
- The per-swarm claim budget avoids raising the global kanban WIP limit for non-swarm users.

## Dependencies

- **ADR-035** (workload-governance/model-routing consumer in pi-coas) must be implemented first, because `/swarm` is its first concrete `maybeGovernanceRoute` caller.
- **CoAS ADR-0008 / T-791** (schedule delivery targeting guard) must be implemented before `/swarm` ships, to keep swarm workers task-scoped and schedule-safe.

## Related

- `docs/deep-dives/2026-07-23-swarm-orchestration-design.md`
- `briefs/2026-07-21-agent-swarm-model-economics-briefing.md`
- `briefs/2026-07-22-token-spend-briefing.md`
- `briefs/2026-07-22-loopgain-investigation-briefing.md`
- `extensions/pi-panopticon/skills/pi-agent-orchestration/SKILL.md`
- T-793 (model-routing), T-791 (delivery guard)
