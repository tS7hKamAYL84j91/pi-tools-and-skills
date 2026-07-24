# /swarm implementation plan

## Goal

Implement ADR-036 `/swarm` as a deterministic, bounded, repo-local worker-pool orchestration feature in `extensions/pi-panopticon/swarm/`. Hard dependencies are landed: ADR-035 (`3163d1a`) and ADR-0008/T-791 (`6bfcaa8`).

## Success criteria

- `/swarm <goal>` command and `swarm_run` tool exist.
- `dry_run=true` default returns a planned task tree without side effects.
- `dry_run=false` spawns at most 3 task-scoped workers, monitors them, reconciles kanban state, runs stacked review gates, and respects all ADR-036 bounds.
- All architecture fitness tests pass: no file exceeds its line budget, no forbidden cross-extension imports, no temporal-coupling violations.
- `npm run check` and `npm test` pass.

## Scope

### Included

- `extensions/pi-panopticon/swarm/` submodule with planner, runner, reconciler, gates, types, tools, commands, and index.
- `/swarm`, `/swarm status`, `/swarm list`, `/swarm cancel` slash commands.
- `swarm_run`, `swarm_status`, `swarm_list`, `swarm_stop` tools.
- Per-swarm kanban claim budget (WIP ≤ 3) using `swarm:<id>` tags.
- Deterministic task-tree planner with dependency ordering.
- Worker spawn via internal spawner primitives (`spawnChild`, `rpcWrite`, `rpcCall`), `scope="task"` by default per ADR-0008.
- Model selection via ADR-035 routing.
- Artifact gates and stacked review using `team_run` (navigator / llm-council / FIRE).
- Max 3 repair cycles per task.
- Wall-clock TTL ceilings: fast=60m, balanced=120m, thorough=240m.
- Teardown on cancel/session_shutdown: kill workers, block in-progress cards.
- Runtime entity registration so `runtime_status` / `runtime_stop` apply.
- Tests: planner, claim budget, runner orchestration, gates, teardown, tool registration.

### Excluded (v1)

- Multi-swarm concurrency.
- Interrupted-recovery (`swarm_resume`).
- Per-token cost ceiling (TTL + worker-minutes cap covers v1).
- Dynamic re-decomposition or peer-to-peer worker communication.

## Decisions

1. **Model routing isolation**: Extract ADR-035 classification/resolution into `lib/coas-governance.ts` so both `extensions/pi-coas` and `extensions/pi-panopticon/swarm` can consume it without cross-extension imports. `extensions/pi-coas/governance.ts` becomes a thin wrapper. Update `tests/architecture/lib-layering.ts` to classify the new lib module.
2. **Kanban state**: `/swarm` creates task cards via `kanban_create` etc. because those are tools invoked by the GM session; the swarm code writes board.log directly only in tests/helpers. In production, the orchestrator calls the existing kanban tool functions or uses equivalent internal board helpers (`extensions/pi-kanban/board.ts`) imported through the shared extension? No — extension isolation forbids pi-panopticon importing pi-kanban. Therefore `/swarm` will **expose kanban mutations through tool calls issued by the outer model** for v1, or use a narrow internal API via `pi.callTool` if available. If not, the runner will be built around spawning worker agents and the GM will still own kanban card creation. To keep v1 deterministic, the plan is: `swarm_run(dry_run=true)` returns a task tree; `swarm_run(dry_run=false)` spawns workers and returns status, while the GM (outer model) is responsible for `kanban_create` calls from the plan before execution. This preserves Gravitas as single kanban writer.
3. **Worker completion contract**: Spawned workers must emit a structured completion signal (`DONE`/`BLOCKED`) via `agent_send` or tool result. The runner uses the existing `lib/completion-signal.ts` parser.
4. **Review gates**: For v1, artifact gates invoke `team_run id="navigator" async=true` and, for architecture/high-stakes tasks, `team_run id="llm-council" async=true`. Results are recorded in the swarm record.
5. **No custom runtime**: Reuse `SpawnerModule`, `Registry`, `RuntimeControlPlane` already present in `pi-panopticon`.

## File layout

```text
extensions/pi-panopticon/swarm/
  index.ts              — extension wiring (called from extensions/pi-panopticon/index.ts)
  swarm-types.ts        — SwarmConfig, SwarmPlan, SwarmTask, SwarmStatus, SwarmRecord
  swarm-planner.ts      — deterministic decomposition into task tree
  swarm-runner.ts       — worker pool lifecycle, monitoring, claim budget
  swarm-reconciler.ts   — DONE/BLOCKED transitions, no-blind-retry, material-successor logic
  swarm-gates.ts        — artifact evidence check + stacked review invocation
  swarm-tools.ts        — swarm_run, swarm_status, swarm_list, swarm_stop tools
  swarm-commands.ts     — /swarm, /swarm status, /swarm list, /swarm cancel commands
```

Also:
- `lib/coas-governance.ts` — extracted pure governance routing (classification + model resolution).
- `extensions/pi-coas/governance.ts` — updated to re-export/use the lib helper.
- `extensions/pi-panopticon/index.ts` — import and call `setupSwarm(pi, { registry, spawner, runtime })`.
- `tests/panopticon/swarm-*.test.ts` — new tests.
- `tests/architecture/lib-layering.ts` — classify `lib/coas-governance.ts`.

## API surface

### Slash command

```text
/swarm <goal> [--profile fast|balanced|thorough] [--wip N] [--execute]
```

### Tools

- `swarm_run goal="..." profile="balanced" wip=3 dry_run=true async=false`
- `swarm_status swarmId="swarm-..."`
- `swarm_list(activeOnly?=false)`
- `swarm_stop swarmId="swarm-..." reason="..."`

## Implementation phases

### Phase 0 — Foundation

- Create `lib/coas-governance.ts` with pure classification/resolution logic and types.
- Refactor `extensions/pi-coas/governance.ts` to delegate to lib helper; ensure existing tests pass.
- Update `tests/architecture/lib-layering.ts` classification.
- Validate: `npm run check`, `npm test`.

### Phase 1 — Core types + planner

- `swarm-types.ts`: `SwarmProfile`, `SwarmPlan`, `SwarmTask`, `SwarmArtifact`, `SwarmStatus`, `SwarmRecord`.
- `swarm-planner.ts`: `planSwarm(goal, profile) -> SwarmPlan`.
  - Deterministic decomposition into 1–6 tasks ordered by dependency.
  - Each task: id (`S-{swarmId}-{index}`), title, brief, allowed tools (read-only vs write), review profile.
  - Planner guard: if goal is un-decomposable, return `blocked` reason.

### Phase 2 — Runner + claim budget

- `swarm-runner.ts`: `SwarmRunner` class.
  - Maintains `Map<swarmId, SwarmRecord>`.
  - Spawns task-scoped workers via spawner primitives with `scope="task"`.
  - Per-swarm claim budget: counts in-progress tasks for this swarm only; refuses new claims beyond `wip` (default 3, hard cap 3).
  - Polls worker health via registry records + `agent_status`-equivalent checks.
  - Enforces TTL ceilings; on breach moves in-progress tasks to `blocked` and records partial evidence.

### Phase 3 — Reconciler + gates

- `swarm-reconciler.ts`: process completion signals; transition tasks to `done`/`blocked`; enforce max 3 repair cycles; material-successor only after review + fresh provenance.
- `swarm-gates.ts`: check artifact evidence; run navigator/council reviews via internal `team_run` dispatch; return verdict `pass`/`revise`/`blocked`.

### Phase 4 — Tools, commands, integration

- `swarm-tools.ts`, `swarm-commands.ts`.
- Wire into `extensions/pi-panopticon/index.ts`.
- Register swarm as runtime entity via `RuntimeControlPlane`.
- Add teardown on `session_shutdown`.

### Phase 5 — Tests + validation

- Unit tests for planner, claim budget, runner state machine, gates, cancel/teardown.
- Integration test for tool registration and `/swarm` command parsing.
- Architecture fitness: line budgets, no cross-extension imports.
- Run `npm run check` and `npm test`; fix any violations without exemptions.

## Risks and mitigations

- **Cross-extension import temptation**: Mitigated by extracting governance routing to `lib/`.
- **Kanban single-writer conflict**: Mitigated by having `/swarm` return plans and status; kanban mutations remain GM-driven.
- **Worker lifecycle complexity**: Mitigated by reusing existing spawner primitives and completion-signal parser.
- **Test flakiness with spawned processes**: Mitigated by mocking spawner and registry in unit tests; keep integration tests narrow.

## Review checkpoints

1. Plan review (this document) — may be reviewed by `llm-council` or Principal if requested.
2. Phase 0–1 review before runner/gates (architecture risk).
3. Full Phase 5 validation before reporting DONE.
