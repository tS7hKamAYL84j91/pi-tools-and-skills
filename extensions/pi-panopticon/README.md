# Pi Panopticon Extension

Multi-agent visibility, messaging, spawning, health checks, lifecycle controls, and modular team workflows for pi sessions.

## Stable Tools/Commands

### Tools

| Tool | Purpose |
|---|---|
| `message_read` / `message_send` | Read and send messages across registered channels such as Matrix or agent transport. |
| `agent_send` / `agent_broadcast` | Send direct or broadcast messages to registered peer agents. |
| `agent_peek` / `agent_status` | Inspect peer activity and health. |
| `spawn_agent` / `rpc_send` | Spawn local RPC workers and send commands to them. |
| `list_spawned` / `kill_agent` | Inspect and stop workers spawned by this session. |
| `get_name` / `set_name` | Read or set this session's display/registry name. |
| `team_*` / `runtime_*` | Run and control modular declarative team workflows. |

### Commands

- `/agents` — open the agent overlay for status, detail, direct messages, and stop/kill controls.
- `/send` — send a direct peer message from the command line.
- `/agent-list-mode` and `/agents-mode` — adjust agent list display mode.
- `/teams` — browse and run modular team workflows.

## Provisional Surfaces

- `MEMORY.md` snapshot generation (currently advisory/design-only).
- Agent stall heuristic thresholds.

## Public and Internal Boundaries

Public compatibility is the registered runtime surface: tools, commands, extension entrypoint/package wiring, documented settings, and persisted session event names such as `pi-teams:run`.

Capability file paths under `extensions/pi-panopticon/{ui,registry,messaging,spawner,teams}/` are internal implementation modules. Tests import those modules directly for precision, but downstream users should not treat deep file paths as stable public API.

## Module and Cross-Extension Dependencies

- Contains the Teams module under `extensions/pi-panopticon/teams/`; team protocols remain isolated from the agent registry/runtime substrate.
- Acts as a foundational registry used by `pi-matrix` for channel registration.

## State and UI

Panopticon registers this session in a local registry, updates heartbeats, and shows an `agents:` status/widget summary. Reconciliation alerts are intentionally sparse: pending messages, blocked peers, confirmed stale workers, and silent worker exits are surfaced; healthy idle peers are suppressed.

Design note: `docs/adr/022-panopticon-memory-snapshot.md` defines the proposed advisory `MEMORY.md` snapshot boundary for future restart/debug/audit support. It is design-only; Panopticon does not currently write these snapshots.

## What this does NOT do

- Does not replace project task boards or CoAS scheduling.
- Does not use Matrix for local agent-to-agent transport; local peers use the registered agent transport.
- Does not persist long-term metrics or analytics beyond operational registry/session state.
- Does not stop the current agent from the `/agents` overlay.
- Does not guarantee worker completion; callers must reconcile missing DONE/BLOCKED/FAILED signals.
