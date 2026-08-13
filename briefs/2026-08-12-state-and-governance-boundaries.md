# State and Governance Boundary Corrections

## Goal

Apply three behavior-preserving boundary corrections:

1. A private swarm task with governance `escalate: true` must not spawn with the provider default.
2. `goal.json` remains the sole authority and derived Markdown must self-heal after any interrupted save.
3. Panopticon operational session state must not probe/store Kanban’s private snapshot path.

## Constraints

- Private swarm routing with no eligible local model blocks the task/swarm with the governance reason and spawns no worker.
- Preserve public/public-unspecified swarm model behavior.
- Save Goal authority before projections; on load, deterministically rewrite all projections from authority, not only missing files.
- Preserve Goal schema and projection formats.
- Remove only unused `kanbanSnapshot` metadata; do not replace it with another private-state probe.
- Do not decide the team-result artifact root or gate-command policy in this slice; those remain escalated architecture decisions.
- No dependencies or fitness exceptions.

## Acceptance criteria

- Swarm tests prove private/no-local route blocks without adapter spawn; configured private local route still spawns.
- Goal failure/recovery tests prove old authority is never paired permanently with new projections and load repairs stale existing projections.
- Panopticon state tests and architecture fitness prove no Kanban private path reference.
- Focused tests, `npm run check`, `npm test`, and `git diff --check` pass.
