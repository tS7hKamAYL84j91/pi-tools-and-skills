---
name: pi-agent-orchestration
description: Coordinate work across pi peer agents. Use when spawning agents, assigning structured briefs, monitoring progress, detecting stalls, nudging blocked agents, or shutting workers down cleanly.
---

# Pi Agent Orchestration

Do the work yourself by default. Use this skill only when the user requests
agents or an independent parallel subtask materially benefits from a worker.
Spawning, monitoring, and handoffs are not prerequisites for implementation.

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
   - Keep sequential coding/debug work in the current agent.
   - Use workers only for independently useful, bounded parallel subtasks.
   - Keep concurrency small and scope each worker's task clearly.

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
   - Use `agent_status` repeatedly over time only for active work or suspected stalls.
   - Use `agent_peek` to inspect recent activity.
   - Read messages with `message_read` only after a new-message notification; do not poll for messages.
   - Distinguish:
     - `active`: working
     - `waiting`: idle
     - `blocked`: self-reported blocker
     - `stalled`: heartbeat alive but no progress across repeated checks
   - A `waiting` agent with a fresh heartbeat (<60s) is idle, not stalled. Current reconciliation suppresses stale-activity noise when all peers are healthy and have no pending messages.
   - For stall detection, call `agent_status` 2–3 times over time. If status stays unchanged or becomes `stalled`/`blocked`, nudge with `agent_send` before escalating.

6. **Intervene when needed**
   - Use `agent_send` with "URGENT:" prefix for stalled or blocked agents.
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

## Agent-to-agent messaging

Use the right transport for the situation:

| Tool | Use for |
|------|---------|
| `rpc_send command="prompt"` | Assign a new task to a spawned agent (RPC mode). Use `wait=true` to block for the result. |
| `agent_send` | Send a follow-up message to a registered peer agent. The agent must already be registered in panopticon. |
| `agent_broadcast` | Send the same message to all (or filtered) registered agents. |
| `team_run` | Invoke a declarative team (llm-council, navigator) for structured review. Default to `async: true`. |

Common mistakes seen in sessions:
- Using `agent_send` before the agent is registered — wait 1–2s after spawn, confirm with `agent_peek`.
- Using `agent_send` for initial task assignment on an RPC-spawned agent — use `rpc_send command="prompt"` instead.
- Confusing `send_agent` (not a tool) with `agent_send` — only `agent_send` exists.
- Using a slash-command prefix like `/gp` — agents communicate via tools, not slash commands.

## Reconciliation alert handling

Pi's reconciler now suppresses idle noise and emits follow-ups only for findings
that likely need intervention:

| Alert | Meaning | Action |
|-------|---------|--------|
| `pending-messages` | A peer has unread inbound messages. | Read or route messages only if this agent owns that channel. |
| `blocked-agent` | Agent self-reports blocked. | Inspect with `agent_status`/`agent_peek`, then nudge with `agent_send` if needed. |
| `stale-worker` | A stale heartbeat or stalled status was confirmed by a fresh status read. | Check with `agent_status`. If still stale or stalled, nudge with `agent_send`. |
| `silent-done` | Agent PID terminated before registry status became `done`/`terminated`. | Inspect output and reconcile or restart the work. |
| `stale-activity` | No workspace activity for 30m+ and at least one peer is not operationally quiet. | Do one `agent_status` check; do not poll repeatedly. |

Rules:
- Never run `git status` or `git diff` just because a reconciliation alert fired.
- Do not expect stale-activity alerts during healthy idle periods; waiting/running peers with fresh heartbeats and no pending messages are suppressed.
- A single stale registry sample is not enough for `stale-worker`; the reconciler confirms before notifying.
- Do not poll `message_read` in response to reconciliation alerts.

## Agent failure & recovery

Agents can die before completing their task. The most common exit code:

**Exit code 143 = SIGTERM.** The process was killed (timeout, resource limit, or external signal). Not a crash.

Recovery checklist when an agent exits without DONE/BLOCKED/FAILED:

1. Check output with `list_spawned name=<agent>` to see what it produced before death.
2. If useful partial output exists, incorporate it.
3. Decide: restart the agent with the same task (if work is still needed), or abandon (if the partial output is sufficient).
4. If a pattern of 143 deaths emerges across similar agent types (e.g. auditors), the task scope or timeout may need adjusting — don't blindly respawn the same task repeatedly.
5. Clean up: `kill_agent` removes the agent from the spawned list. Orphaned agents should not accumulate.

## Integrating results

Inspect worker output, preserve unrelated changes, and run relevant checks.
A worker's success claim is not validation. Report the useful result and any
remaining issue without duplicating transcripts or maintaining a progress log.
Commit or push only when authorized. A brief or planning document does not grant
permissions; ask the user if a genuine requirement or safety decision blocks work.
