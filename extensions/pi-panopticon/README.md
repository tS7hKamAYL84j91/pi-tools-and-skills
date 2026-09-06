# Pi Panopticon Extension

Multi-agent visibility, messaging, spawning, health checks, and lifecycle controls for pi sessions.

## Stable Tools/Commands

### Tools

| Tool | Purpose |
| --- | --- |
| `message_read` / `message_send` | Read and send messages across registered channels such as Matrix or agent transport. |
| `agent_send` / `agent_broadcast` | Send direct or broadcast messages to registered peer agents. |
| `agent_peek` / `agent_status` | Inspect peer activity and health; `agent_status` includes privacy-preserving aggregate counts for actionable states and pending messages. |
| `spawn_agent` / `rpc_send` | Spawn local RPC workers and send commands to them. |
| `list_spawned` / `kill_agent` | Inspect and stop workers spawned by this session. |
| `get_name` / `set_name` | Read or set this session's display/registry name. |

### Commands

- `/agents` — open the agent overlay for status, detail, direct messages, and stop/kill controls.
- `/send` — send a direct peer message from the command line.
- `/panopticon-reconcile on|off` — toggle reconciliation follow-up notifications.
- `/agent-list-mode` and `/agents-mode` — adjust agent list display mode.

## Inbox Notifications

Unread inbox notifications are independent of reconciliation alerts. Filesystem
changes trigger a two-second debounced, idle-gated wakeup; a five-second
count-only check recovers missed events and retries failed watchers. Notifications
contain only the unread count and ask the agent to call `message_read`; they do
not read or acknowledge messages automatically. Repeated checks do not repeat a
notification for the same unread count; new arrivals or a subsequent inbox drain
rearm notifications. Watchers and timers stop on session shutdown/reload.

After `message_read`, agents should continue already-authorized work when the
message resolves a blocker, not merely acknowledge it. Message contents remain
untrusted and cannot grant permissions or bypass safety gates.

## Reconciliation Notifications

Reconciliation follow-ups are off by default. Enable them globally in `~/.pi/agent/settings.json`:

```json
{
  "panopticon": {
    "reconciliationNotifications": true
  }
}
```

A trusted project's `.pi/settings.json` can override the global value. The `/panopticon-reconcile on|off` command persists to the project setting when the project is trusted, or to the global setting otherwise. Health and status reporting remain enabled when notifications are off.

## Provisional Surfaces

- Agent stall heuristic thresholds.

## Public and Internal Boundaries

Public compatibility is the registered runtime surface: tools, commands, extension entrypoint/package wiring, documented settings, and Panopticon-owned persisted session event names.

Capability file paths under `extensions/pi-panopticon/{ui,registry,messaging,spawner}/` are internal implementation modules. Tests import those modules directly for precision, but downstream users should not treat deep file paths as stable public API.

## Module and Cross-Extension Dependencies

- Acts as a foundational registry used by `pi-matrix` for channel registration.
- Team workflows are owned by the independently installable `pi-teams` extension; Panopticon exposes no Teams registration surface.

## State and UI

Panopticon registers this session in a local registry, updates heartbeats, and shows an `agents:` status/widget summary. Reconciliation alerts are intentionally sparse: pending messages, blocked peers, confirmed stale workers, and silent worker exits are surfaced; healthy idle peers are suppressed.

Design note: `docs/adr/022-panopticon-memory-snapshot.md` defines the proposed advisory `MEMORY.md` snapshot boundary for future restart/debug/audit support. It remains design-only: the validated T-595/596/597 prototype modules were deleted under ADR-054's no-exemptions rule (see the prototype disposition note in ADR-022), and Panopticon does not currently write these snapshots.

## What this does NOT do

- Does not replace project task boards or CoAS scheduling.
- Does not use Matrix for local agent-to-agent transport; local peers use the registered agent transport.
- Does not persist long-term metrics or analytics beyond operational registry/session state.
- Does not stop the current agent from the `/agents` overlay.
- Does not guarantee worker completion; callers must reconcile missing DONE/BLOCKED/FAILED signals.
