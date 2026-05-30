# Option A Panopticon Runtime Consolidation — Phase 1 Inventory

Date: 2026-05-30
Source goal: `docs/reports/option-a-panopticon-runtime-consolidation-goal.md`
ADR: `docs/adr/025-panopticon-runtime-control-plane.md`

## Summary

Phase 1 confirms the current boundary: `pi-panopticon` owns live-agent runtime substrate, while `pi-teams` owns protocol logic but contains direct runtime dependencies that should be routed through a narrow Panopticon adapter in later phases.

## Current Panopticon runtime substrate

| Area | Current files | Notes |
|---|---|---|
| Registry / visibility | `extensions/pi-panopticon/registry.ts`, `visibility.ts`, `peers.ts`, `health.ts`, `reconciler.ts`, `lib/agent-registry.ts`, `lib/agent-api.ts` | Canonical live-agent records, visibility, health/stall status, current-agent lookup. |
| Spawn / stop / RPC | `extensions/pi-panopticon/spawner.ts`, `spawner-tools.ts`, `spawner-utils.ts`, `agent-stop.ts`, `lib/spawn-service.ts`, `lib/runtime-child-process.ts`, `lib/runtime-control-plane.ts` | Persistent agent spawning and process control surface, the shared one-shot child-process adapter, and the session-local runtime entity control-plane adapter introduced for Phase 2. |
| Messaging | `extensions/pi-panopticon/messaging*.ts`, `agent-message-overlay.ts`, `lib/message-transport.ts`, `lib/runtime-agent-messaging.ts`, `lib/transports/maildir.ts` | Agent-to-agent routing and channel integration, plus the Phase 2 runtime messaging adapter for team live-agent nodes. |
| Runtime UX | `agents-command.ts`, `agent-overlay.ts`, `list-mode*.ts`, `status-widget.ts`, `ui*.ts`, `peek.ts` | Agent-oriented status/inspect/list UI. |

## `pi-teams` runtime/process dependencies

| File | Dependency | Current behavior | Proposed adapter boundary |
|---|---|---|---|
| `extensions/pi-teams/runner.ts` | `spawnRuntimeChildProcess()`, `resolvePiBinary()`, `PANOPTICON_PARENT_ID_ENV`, `PANOPTICON_VISIBILITY_ENV`, `findCurrentAgent()` | Runs one-shot `pi --print` model calls through the shared runtime child-process adapter and forwards scoped parent visibility. | Done for child-process spawn/cancel in Phase 2; remaining follow-up is parent/child runtime event/link metadata. |
| `extensions/pi-teams/team-runtime.ts` | `RuntimeControlPlane`, `AbortController`, interval status widget, `team_stop` state mutation | Creates team run ids, owns stop controller, records completion/failure, exposes team run controls. Team-run entities are registered in the runtime adapter, status is mirrored on completion/stop/failure, and unified stop delegates through `RuntimeControlPlane.stopEntity()` when present. | Team protocol state remains in teams; runtime entity registration/status/stop now flows through the Panopticon adapter boundary. |
| `extensions/pi-teams/team-node-runner.ts` | nested `AbortController`, timeout cancellation, parent id propagation | Bridges protocol nodes to either live agents or one-shot model calls. | Keep node selection/retry semantics here; move runtime cancellation/linkage to adapter calls. |
| `extensions/pi-teams/live-agent.ts` | `findAgentByName()`, `listLiveAgents()`, `getMaildirTransport()`, `sendRuntimeAgentMessage()`, protocol response polling/ack, optional `RuntimeControlPlane` | Routes explicit `agent:<name>` team nodes through Panopticon-style registry and the runtime messaging adapter. | Messaging send/receive/ack is behind `lib/runtime-agent-messaging.ts`; when a runtime parent is supplied, contacted live agents are registered as child runtime entities of the team run. |
| `extensions/pi-teams/state.ts` | in-memory run state, stop controllers | Session-local team run state and abort controller registry. | Remains team-owned for protocol detail; runtime adapter should mirror/publicize entity status and stop requests. |
| `extensions/pi-teams/team-tools.ts`, `team-commands.ts`, `team-overlay.ts` | team status/list/inspect UX | Team-specific control surfaces. | Cross-link to unified runtime list/status once available; preserve compatibility commands. |
| `extensions/pi-teams/worktree-isolation.ts` | filesystem/git lifecycle helper | Experimental, not wired into default `team_run`. | Remains out of consolidation runtime until a separate approved worktree promotion design. |
| `extensions/pi-teams/observability.ts` | event serialization helper | Internal/provisional JSONL mapper per ADR 024. | May map runtime events later only after explicit promotion; not a durable runtime event stream now. |

## Adapter candidates

A minimal Panopticon runtime adapter should be additive and internal first:

```ts
interface RuntimeEntityRef {
  id: string;
  kind: "agent" | "team_run" | "child_process";
}

interface RuntimeChildProcessRequest {
  parent: RuntimeEntityRef;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
}
```

Implemented Phase 2 operations:

- `spawnRuntimeChildProcess(request)` — owns child process spawn, scoped visibility env, and SIGTERM-on-abort.
- `RuntimeControlPlane.registerEntity(request)` / `updateStatus(ref, status)` — lets team runs appear beside agents without pretending to be agents.
- `RuntimeControlPlane.stopEntity(ref, reason)` — invokes a registered stop adapter and records stop-request events.
- `RuntimeControlPlane.inspectEntity(ref)` / `listEntities()` — returns status and parent/child links.
- `RuntimeControlPlane.linkEntities(parent, child)` — records parent/child lineage.
- `RuntimeControlPlane.emitEvent(event)` / `listEvents()` — provides an internal runtime event stream shape for lifecycle/status events.

Additional Phase 2 operations:

- `sendRuntimeAgentMessage(request)` / `receiveRuntimeAgentMessages()` / `ackRuntimeAgentMessage()` — centralizes live-agent message send/receive/ack boundaries for team nodes and emits runtime message events when a `RuntimeControlPlane` is supplied.
- Live-agent node entity registration/linkage — `runLiveAgentNode()` registers the contacted live agent as an `agent` runtime entity and links it to the supplied team-run parent.

## Architecture-test follow-up

Add or extend an architecture test so `pi-teams` cannot introduce new direct process lifecycle dependencies outside approved adapter boundaries. Initial allowed exceptions before Phase 2:

- `extensions/pi-teams/runner.ts` may use `node:child_process` until the adapter exists.
- `extensions/pi-teams/worktree-isolation.ts` may use direct process execution only as an experimental isolated helper and must not be wired into default runtime without a separate ADR.

Phase 2 update: `runner.ts` no longer imports `node:child_process`; child-process lifecycle is centralized in `lib/runtime-child-process.ts`. Runtime status/inspect/stop/event/link primitives are centralized in `lib/runtime-control-plane.ts`. Live-agent message delivery is routed through `lib/runtime-agent-messaging.ts`, and live-agent node participation can be registered/linked under team-run parents through `RuntimeControlPlane`. Phase 3 slice update: `team-runtime.ts` now registers team-run entities in the runtime control-plane adapter, mirrors terminal status, exposes runtime snapshots from `runtime_status`, and routes `runtime_stop`/`team_stop` through the runtime stop delegate when available. The remaining `pi-teams` exception is `worktree-isolation.ts`, which stays experimental and outside default team runtime.

## Out of scope for this phase

- Moving files between extension packages.
- Renaming or removing public `team_*` tools in this phase. Later unified-runtime phases may remove redundant compatibility aliases if that is the simpler YAGNI path.
- Wiring worktree isolation or approval gates into default runtime.
- Promoting observability JSONL into a public/durable event stream.
- Implementing unified runtime UI.
