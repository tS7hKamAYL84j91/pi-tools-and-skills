# Swarm dry-run overview plan

## Goal

Make `swarm_run` dry-run output a compact, Teams-style human-readable preflight while retaining the existing structured `plan` details and spawning no workers.

## Output contract

The dry-run text must include:

- explicit `dry run; no workers spawned` statement;
- goal, profile, and requested/effective WIP cap;
- task count and dependency ordering;
- one concise row per task: ordinal/id, title, read-only or write-enabled, dependency, review profile;
- static governance bounds: max six tasks, WIP ≤3, max three repair cycles, TTL/ceiling enforcement;
- exact next action: rerun with `dry_run:false`.

## Constraints

- No execution, planner, runtime entity, tool schema, model routing, or persistence changes.
- Preserve `details.plan` and `details.dryRun: true` shape.
- Keep output concise for model context; no full task brief bodies.
- Add deterministic tests for a multi-task plan and blocked/empty plan.
- No architecture-fitness exemptions.

## Progress visibility

`swarm_status` and `swarm_list` must expose a concise, agent-readable live overview, analogous to `team_runs`, while retaining their structured record details:

- swarm id, state, goal, profile, effective WIP, and active/complete/blocked/failed task counts;
- per-task state, dependency readiness, worker name when assigned, repair-cycle count, review profile, and artifact count;
- a clear stopping/stopped/failed reason when present;
- no raw worker prompts, private task briefs, or full artifacts in the compact text view.

## Acceptance criteria

- Dry-run text is understandable without inspecting JSON details.
- It correctly reports dependencies/review profile/tool mode from the deterministic plan.
- `swarm_status` and `swarm_list` give agents a compact live progress overview without requiring JSON inspection.
- Non-dry execution behavior and structured details are unchanged.
- `npm run check` and `npm test` pass.
