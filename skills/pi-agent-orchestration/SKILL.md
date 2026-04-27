---
name: pi-agent-orchestration
description: Coordinate work across pi peer agents. Use when spawning agents, assigning structured briefs, monitoring progress, detecting stalls, nudging blocked agents, or shutting workers down cleanly.
---

# Pi Agent Orchestration

Use this skill when work should be delegated to one or more pi agents.

## When to use

Use this skill for:
- spawning a worker for a focused subtask
- assigning a structured brief instead of an ad-hoc prompt
- monitoring long-running work
- detecting stalled or blocked agents
- coordinating completion, follow-ups, or shutdown

Do not use this skill for simple single-agent tasks.

## Workflow

1. **Decide topology**
   - Use a single worker for sequential coding/debug tasks.
   - Use multiple workers only for parallelisable research or scanning.
   - Keep WIP small and avoid spawning agents without a clear owner.

2. **Spawn with a structured brief**
   - Prefer `brief` over `task`.
   - Include:
     - `classification`
     - `goal`
     - `successCriteria`
     - `scope.include`
     - `scope.exclude` when needed

3. **Wait for registration**
   - After `spawn_agent`, allow 1–2 seconds for panopticon registration.
   - Confirm with `agent_peek` before normal messaging.

4. **Assign work**
   - Use `rpc_send command="prompt"` for the main task.
   - Use `wait=true` when you want the completed result inline.
   - Use `agent_send` for normal peer-to-peer follow-up messages.

5. **Monitor progress**
   - Use `agent_status` repeatedly over time.
   - Use `agent_peek` to inspect recent activity.
   - Distinguish:
     - `active`: working
     - `waiting`: idle
     - `blocked`: self-reported blocker
     - `stalled`: heartbeat alive but no progress across repeated checks

6. **Intervene when needed**
   - Use `agent_nudge` for stalled or blocked agents.
   - Use `rpc_send command="steer"` to redirect current work.
   - Use `rpc_send command="follow_up"` after current work completes.

7. **Close out**
   - Collect the result.
   - If the worker is no longer needed, stop it with `kill_agent`.
   - Avoid leaving orphaned workers running.

## Brief template

Use a brief shaped like this:

```yaml
classification: sequential | parallelisable | high-entropy-search | tool-heavy
goal: Clear statement of the outcome required
successCriteria:
  - Specific measurable result 1
  - Specific measurable result 2
scope:
  include:
    - files, dirs, or domains in scope
  exclude:
    - out-of-scope areas
context: Additional constraints, assumptions, or background
```

## Operating rules

- Prefer one good worker over many vague workers.
- Do not send work before the agent is registered.
- Use `agent_status` periodically; stall detection depends on repeated checks.
- Nudge before killing unless the task is clearly unrecoverable.
- Keep success criteria concrete so completion is easy to verify.

## Companion memory

For command reminders and gotchas, use the `pi-agent-orchestration` pi cheatsheet.
