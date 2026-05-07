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
   - Use `agent_status` repeatedly over time only for active work or suspected stalls.
   - Use `agent_peek` to inspect recent activity.
   - Read messages with `message_read` only after a new-message notification; do not poll for messages.
   - Distinguish:
     - `active`: working
     - `waiting`: idle
     - `blocked`: self-reported blocker
     - `stalled`: heartbeat alive but no progress across repeated checks
   - A `waiting` agent with a fresh heartbeat (<60s) is idle, not stalled. Reconciliation alerts for stale activity during long idle periods are expected; one status check is enough.
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

Pi's reconciler emits three alert types. Not all require action:

| Alert | Meaning | Action |
|-------|---------|--------|
| `stale-worker` | Agent heartbeat >10m stale. PID may be dead. | Check with `agent_status`. If terminated, note the failure. If alive but stale, nudge with `agent_send`. |
| `stale-activity` | No workspace activity for 30m+. Expected during idle periods. | Do **one** `agent_status` check. If all peers are `waiting` with fresh heartbeats, no action needed. Do not poll repeatedly. |
| `silent-done` | Agent PID terminated but registry still shows status. | Run `agent_status` to reconcile. The registry will update automatically. |

Rules:
- Never run `git status` or `git diff` just because a reconciliation alert fired.
- One `agent_status` check is enough to triage a `stale-activity` alert.
- A `stale-worker` alert for an agent with a live heartbeat and `waiting` status is benign — the heartbeat takes precedence over the alert.
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

## Pipeline orchestration

Complex work follows a recurring pipeline pattern:

```
1. Create planning doc (docs/<name>.md)
2. council review (team_run id="llm-council" async=true)
3. Spawn subagents for parallel workstreams
4. Monitor with agent_status (not polling)
5. Review subagent output, integrate patches
6. navigator review (team_run id="navigator" async=true)
7. Commit and push
```

Pipeline rules:
- Stagger spawns: don't launch 10 agents simultaneously. Batch in groups of 2–3.
- Each subagent gets a focused brief scoped to one workstream.
- The orchestrator integrates, never subagents.
- Update the planning doc as evidence of progress (checked items, notes).
- Use `agent_status` checkpoints after each pipeline stage, not continuously.
- If a subagent dies (exit 143), decide restart vs abandon before advancing to the next stage.
- Never block the pipeline waiting for the user; the planning doc is the authority.
