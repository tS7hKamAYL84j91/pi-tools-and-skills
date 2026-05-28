# Pi Panopticon Extension

Multi-agent visibility, messaging, spawning, health checks, and lifecycle controls for pi sessions.

## Tools

| Tool | Purpose |
|---|---|
| `message_read` / `message_send` | Read and send messages across registered channels such as Matrix or agent transport. |
| `agent_send` / `agent_broadcast` | Send direct or broadcast messages to registered peer agents. |
| `agent_peek` / `agent_status` | Inspect peer activity and health. |
| `spawn_agent` / `rpc_send` | Spawn local RPC workers and send commands to them. |
| `list_spawned` / `kill_agent` | Inspect and stop workers spawned by this session. |
| `get_name` / `set_name` | Read or set this session's display/registry name. |

## Commands

- `/agents` — open the agent overlay for status, detail, direct messages, and stop/kill controls.
- `/send` — send a direct peer message from the command line.
- `/agent-list-mode` and `/agents-mode` — adjust agent list display mode.

## State and UI

Panopticon registers this session in a local registry, updates heartbeats, and shows an `agents:` status/widget summary. Reconciliation alerts are intentionally sparse: pending messages, blocked peers, confirmed stale workers, and silent worker exits are surfaced; healthy idle peers are suppressed.

## What this does NOT do

- Does not replace project task boards, CoAS scheduling, or team protocols.
- Does not use Matrix for local agent-to-agent transport; local peers use the registered agent transport.
- Does not persist long-term metrics or analytics beyond operational registry/session state.
- Does not stop the current agent from the `/agents` overlay.
- Does not guarantee worker completion; callers must reconcile missing DONE/BLOCKED/FAILED signals.
