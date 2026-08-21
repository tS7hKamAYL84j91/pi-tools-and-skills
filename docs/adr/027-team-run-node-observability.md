# ADR 027: Team-Run Node Observability — Live Progress, Heartbeat, and Stall Detection

**Status:** Approved (council PASS with amendments)
**Date:** 2026-06-20
**Source:** historical `docs/archive/reports/t-739-team-run-observability-design.md` in git history; Navigator review PASS; council review PASS with amendments.

## Context

During run `team-mqm4dr9m` the council reached a stuck state: 5 member/generation nodes completed, but the `glm-5.2` synthesis node sat for 10+ minutes. The runtime surface showed **zero running workers**, yet the team run was still marked `running`. Today the agent and TUI can only see aggregate `nodes=N`; there is no per-node progress, no heartbeat, and no signal to distinguish *slow-but-alive* from *hung*.

Current `TeamRunRecord` (in `extensions/pi-teams/state.ts`) stores:

- `status`, `phases[]`, `nodes[]` (only completed nodes), `details[]`, timing, and terminal state.

Events emitted today are `run_started`, `phase_started`, `node_completed`, `run_detail`, `stop_requested`, and terminal events. There is **no in-flight node event**.

`runTeamNode` in `team-node-runner.ts` supports `timeoutMs` and an `AbortSignal`, but emits nothing while a node is in flight. Recovery for a stuck run is only a blunt `/team stop <runId>`.

## Decision

Add two new additive team-run event kinds and expose derived per-node status through a separate in-flight node collection. Keep all new fields optional so existing persisted records remain valid and keep the existing `nodes[]` array as the **completed/failed node record** set. Surface the new information in `team_runs`, `runtime_status`, the TUI widget, and the stop response. Keep event and record schema versions at 1 because the change is strictly additive.

### 1. New event kinds

```ts
interface TeamRunNodeStartedEvent extends TeamRunEventBase {
  kind: "node_started";
  phaseId: string;
  nodeId: string;
  role: string;
  model: string;
}

interface TeamRunNodeHeartbeatEvent extends TeamRunEventBase {
  kind: "node_heartbeat";
  phaseId: string;
  nodeId: string;
  role: string;
  model: string;
  elapsedMs: number;
  runningWorkers: number;
}
```

- `node_started` is emitted once when `runTeamNode` begins.
- `node_heartbeat` is emitted every 5 seconds while the node is in flight.
- `runningWorkers` is 1 while the underlying model call or live-agent node is active, and 0 if the orchestrator has no executing worker for that node. For opaque `runMember` calls, v1 uses the simple heuristic: 1 while `runMember` has not returned, so `runningWorkers` is not a reliable signal for stalls *inside* an opaque call. The `no_heartbeat` stall rule still catches those.

### 2. Separate in-flight node record

To avoid changing the meaning of the existing `nodes[]` completed-node array, in-flight state is stored separately:

```ts
export interface TeamRunInFlightNode {
  phaseId: string;
  nodeId: string;
  role: string;
  model: string;
  status: "running" | "stopped";
  startedAt: number;
  updatedAt: number;
  runningWorkers: number;
}
```

`TeamRunRecord` gains an optional array:

```ts
export interface TeamRunRecord {
  // ... existing fields ...
  inFlightNodes?: TeamRunInFlightNode[];
}
```

The state reducer transitions an in-flight node:

- `node_started` → create record in `inFlightNodes` with `status="running"`, capture `startedAt`/`updatedAt`, `runningWorkers=1`.
- `node_heartbeat` → update `updatedAt`, `runningWorkers`.
- `node_completed` → remove the matching in-flight node and append a normal `TeamRunNodeRecord` to `nodes[]` with `ok`/`durationMs`/`output`.
- `stop_requested` → mark every current in-flight node `status="stopped"` (the orchestrator will still record a terminal `node_completed` when the call aborts).
- terminal events (`run_stopped`, `run_completed`, `run_failed`, `run_tombstoned`) → clear `inFlightNodes`.

The existing `TeamRunNodeRecord` shape is unchanged; completed/failed node records remain exactly as before.

### 3. Stall-detection algorithm (read-side only)

A node is classified as **stalled** when `status === "running"` and:

- `now - updatedAt > 30_000` (`no_heartbeat`); or
- `runningWorkers === 0 && now - updatedAt > 60_000` (`idle_stall`).

`node_timeout` is handled internally by `runTeamNode` (it aborts and records a failed `node_completed`), so it is not a stall-read signal.

The stall flag is computed on read by tools and the TUI; it is **not** persisted as its own event. Tools recalculate it whenever they render, and the TUI recomputes it inside the existing 1-second widget refresh interval.

### 4. Tool and TUI output changes

`team_runs` line format is extended, keeping the current prefix-less shape:

```
<runId> <team> <protocol> <status> phases=P nodes=N running=R stalled=S details=K current=<role>/<model>
```

- `nodes` continues to count **completed/failed** nodes in `nodes[]`.
- `running` and `stalled` are derived from `inFlightNodes`.
- `current` shows the most recently updated running in-flight node.

`runtime_status` line format is extended, keeping the `team_run` prefix:

```
team_run <id> <team> <protocol> <status> phases=P nodes=N running=R stalled=S details=K current=<phase>/<node>
```

`runtime_status` details, per `team_run` entity, now include:

- `run`: entity snapshot (`id`, `status`, `updatedAt`)
- `phases` count
- `nodes` array with `nodeId`, `role`, `model`, `status`, `elapsedMs`, `runningWorkers`, `stalled`
- `current` node id and phase

`team_stop` / `runtime_stop` keep run-level semantics. Their response text and details list running/stalled nodes so the user knows what is being cancelled:

```
Team run <runId> stopping: <reason>
Running nodes: synthesis (glm-5.2) 10m 12s, stalled
```

The `details` object gains:

```ts
{
  // ... existing fields ...
  runningNodes: Array<{ nodeId: string; role: string; model: string; elapsedMs: number; stalled: boolean }>;
  stalledNodes: Array<{ nodeId: string; role: string; model: string; elapsedMs: number }>;
}
```

The TUI widget (`refreshTeamWidget`) shows:

```
team: <id> (<protocol>)
phase: <phase>
time: <elapsed>
nodes: <total> (running=<R> stalled=<S> done=<D>)
current: <role> (<model>) <elapsed>
artifacts: ...
cancel: /team stop <runId>
```

- `<total>` = completed nodes + running in-flight nodes.
- `<D>` = completed/failed node count (`nodes.length`).
- Stalled `current` lines are suffixed with a warning marker.

### 5. Schema version

Keep `TEAM_RUN_EVENT_SCHEMA_VERSION` at 1 and `TEAM_RUN_RECORD_VERSION` at 1. The new event kinds are additive; unknown kinds are ignored by older code. If a later change makes in-flight node fields required, changes the reduced record shape, or removes the separate in-flight boundary, the *record* version will be bumped then. If a later change makes event kinds non-additive or renames required fields, the *event schema* version will be bumped then.

### 6. Observability JSONL mapping

`observability.ts` maps `node_started` to a `trace` observability event for local timelines and ignores `node_heartbeat` to avoid JSONL bloat. Because the observability JSONL is internal/provisional per ADR 024, this mapping is not a public contract.

## Consequences

### Positive

- Agents and users can see which node is currently running, how long it has been running, and whether it appears stalled.
- The `team-mqm4dr9m` pattern (members done, synthesis idle) becomes detectable as `runningWorkers=0` stall once the orchestrator exposes idle scheduling.
- Whole-run stop becomes actionable because the response names the affected nodes.
- Changes are additive; existing persisted session records remain valid and rendered correctly.

### Negative / mitigations

- **Session log bloat:** heartbeats are emitted only while a node is running, at a 5-second interval, and stop immediately on completion.
- **`runningWorkers` imprecision for opaque calls:** v1 uses a simple in-flight heuristic. A later iteration can integrate with child-process or streaming tracking.
- **False-positive stall marks on very slow healthy nodes:** thresholds are read-side only; the UI shows a stall marker, it does not auto-stop the run.

## Alternatives considered

- **Add optional fields directly to `TeamRunNodeRecord`.** Rejected because it would have made `ok`, `durationMs`, and `output` optional, changed the meaning of `nodes.length` for many consumers, and broken the existing completed-node contract.
- **Progress-based heartbeats (token deltas).** Rejected for v1 because provider token streaming is not exposed through `runMember` today.
- **Per-node `AbortController` and stop in v1.** Rejected as a v1 requirement; deferred to v1.1 to keep the public-contract change smaller.
- **Bump event schema version to 2.** Rejected because the change is additive and old code safely ignores unknown event kinds.

## Deferred work

- v1.1: shared handler pre-flight availability check for pinned models (extends `team-handler-fusion.ts` pattern to debate/research/consult).
- v1.1: per-node stop via optional `nodeId` parameter on `team_stop` / `runtime_stop`.
- v1.1: richer `runningWorkers` integration with runtime child-process tracking.

## Open questions resolved by this ADR

1. 5-second heartbeat interval for v1.
2. Keep event schema version at 1 and record version at 1.
3. Stall detection computed on read and inside the existing 1-second widget refresh interval; no separate background loop for v1.
4. In-flight state stored separately from completed `nodes[]`.
5. Per-node stop deferred to v1.1.

## Implementation status

Council review PASS with amendments (see required changes above). Implementation was attempted in the same bounded run, but the shared working tree was concurrently modified by another agent/process, producing inconsistent files (duplicated constants, mixed in-flight/completed-node shapes). The ADR design is approved; implementation should proceed only after the working tree is reset to a stable baseline and a single implementation owner runs the runtime changes to completion.
