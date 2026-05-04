## P5 Mini-Spec: Graph Execution Engine for `pi-teams`

### Goal

Promote `extensions/pi-teams/team-graph.ts` from a sequential graph runner into the shared DAG executor for graph-defined teams, while keeping implementation small and deferring protocol lowering until P3/P4 are stable.

P5 should wait on:

- **P2:** prompt resolver API and prompt/template precedence are finalized.
- **P3:** common `pi-teams:run` session-state writer/event schema exists.
- **P4:** protocol-first schema migration settles how graph teams are selected.

---

## Scope

### Include

- `extensions/pi-teams/team-graph.ts`
- `extensions/pi-teams/team-types.ts`
- `extensions/pi-teams/team-handlers.ts`
- tests
- `docs/teams-future-improvements-todo.md`

### Exclude

- `node_modules`
- `.git`
- large graph DSL / custom reducers beyond one deterministic default

---

## Target Behavior

### Graph model

For P5, graph nodes remain the existing `TeamAgentBinding[]` entries.

- `binding.role` is the node id.
- `team.graph.edges` define dependencies by role.
- Node execution uses the binding’s effective:
  - subagent/system prompt from P2 resolver,
  - template id from P2 resolver,
  - model/tools/parameters from P1 config propagation,
  - limits from team/runtime settings.

Do **not** introduce a separate full node DSL yet. Add only minimal fields needed for execution policy.

---

## Type Changes

### `team-types.ts`

Add/extend:

```ts
export type TeamGraphDependencyPolicy = "require-ok" | "allow-failed";
export type TeamGraphReducer = "concat";

export interface TeamAgentBinding extends GenerationConfig {
  role: string;
  subagent: string;
  model?: string;
  label?: string;
  promptId?: string;      // from P2
  templateId?: string;    // from P2
  systemPrompt?: string;
  dependencyPolicy?: TeamGraphDependencyPolicy;
}

export interface TeamLimits {
  timeoutMs?: number;
  maxFixPasses?: number;
  maxConcurrency?: number;
}

export interface TeamGraph {
  edges: TeamGraphEdge[];
  outputs?: string[];
  reducer?: TeamGraphReducer;
}
```

Rules:

- `reducer` defaults to `"concat"`.
- Any non-`concat` reducer is invalid in P5.
- `outputs` defaults to graph sinks.
- `dependencyPolicy` defaults to `"require-ok"`.

If P2/P4 already add `promptId`, `templateId`, or schema-v2 fields, reuse those definitions rather than duplicating.

---

## DAG Validation

Implement/export a validation helper from `team-graph.ts`:

```ts
export interface GraphValidationResult {
  roles: string[];
  roots: string[];
  sinks: string[];
  levels: string[][];
}

export function validateTeamGraph(team: TeamSpec): GraphValidationResult;
```

Validation should run before any child model call.

### Required checks

1. **Non-empty nodes**
   - `team.agentBindings.length > 0`.

2. **Unique roles**
   - Every `binding.role` must be non-empty and unique.
   - Duplicate role error example:
     - `Team graph has duplicate role "reviewer".`

3. **Known edge endpoints**
   - Every `edge.from` and `edge.to` must match a binding role.
   - Error examples:
     - `Graph edge references unknown from role "x".`
     - `Graph edge references unknown to role "y".`

4. **No self edges**
   - `from !== to`.

5. **No duplicate edges**
   - Reject duplicate `from -> to` edges to avoid duplicate upstream packaging.

6. **Acyclic**
   - Use Kahn’s algorithm.
   - If processed node count is less than role count, throw:
     - `Team graph contains a cycle.`

7. **Connected graph**
   - For graphs with more than one node, all nodes must be in one weakly connected component.
   - Reject accidental disconnected subgraphs:
     - `Team graph is disconnected; every node must connect to the same DAG.`

8. **Valid outputs**
   - `graph.outputs`, if present, must reference known roles.
   - If absent, outputs are all sinks.
   - There must be at least one sink/output.

9. **Supported reducer**
   - Missing or `"concat"` is valid.
   - Any other reducer throws:
     - `Unsupported graph reducer "x"; supported reducers: concat.`

10. **Model availability**
   - Effective model per node must resolve before launch.
   - Resolution order:
     1. `binding.model`
     2. `team.models.members[index]` for that binding index, if present
   - No “first member model for every node” fallback.
   - Missing model error:
     - `Graph node "qa" needs a model binding.`

---

## Node Execution Semantics

### Node lifecycle

Each node has one terminal status:

```ts
type GraphNodeStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";
```

Execution rules:

1. A node becomes ready when all direct predecessors are terminal.
2. If any predecessor failed/skipped/cancelled:
   - default `dependencyPolicy: "require-ok"` skips this node;
   - `dependencyPolicy: "allow-failed"` runs and packages failed predecessor metadata.
3. A node executes at most once.
4. A child model failure does not throw from the scheduler; it records a failed node result.
5. The graph run itself returns successfully with `ok: false` unless validation or setup fails before scheduling.
6. Parent abort cancels running nodes and marks unscheduled descendants as skipped/cancelled.
7. `limits.timeoutMs` is a **per-node timeout** for P5.

### Node call

Each node uses `runMember` by default, but `team-graph.ts` should accept an internal injectable runner for tests.

```ts
interface GraphRunArgs {
  team: TeamSpec;
  prompt: string;
  ctx: ExtensionContext;
  stateWriter?: TeamRunStateWriter; // P3-provided shape
  timeoutMs?: number;
  maxConcurrency?: number;
  onProgress?: (text: string) => void;

  // test-only/internal dependency injection
  runNode?: GraphNodeRunner;
}
```

The production runner:

- uses current `runMember`,
- passes `cwd`,
- passes parent panopticon id,
- passes effective tools/parameters,
- uses node/system prompt resolved through P2.

---

## P2 Prompt Resolver Integration

P5 must not call a hardcoded settings key for graph templates directly.

Expected resolver behavior:

- System prompt:
  - use P2 system resolution for the binding/subagent;
  - binding `systemPrompt` remains highest precedence.
- Template:
  - use the graph protocol contract's open string node template slot, e.g. `node.template`;
  - team prompt override via P2;
  - binding `templateId` override via P2.

Graph node template variables:

```ts
{
  prompt: string;       // original user prompt
  role: string;         // node role
  label: string;        // binding.label ?? binding.role
  inputs: string;       // formatted direct dependency package
}
```

Keep `inputs` text-based for P5. Do not add JSON-mode, schemas, or custom reducers yet.

---

## Dependency / Result Packaging

Only direct predecessors are packaged into a node prompt.

Order is deterministic:

1. predecessor order by original `team.agentBindings` order;
2. never by completion time.

Default upstream package:

```md
## <role>
Label: <label>
Status: succeeded
Model: <model>

<output>
```

For failed/skipped upstreams under `allow-failed`:

```md
## <role>
Label: <label>
Status: failed
Model: <model>
Error: <error>

<partial output if any>
```

If no upstreams:

```md
(none)
```

Final graph output:

- Use `team.graph.outputs` if present, else graph sinks.
- Sort outputs by `team.agentBindings` order.
- Reducer `"concat"` joins successful output blocks with blank lines.
- If all output nodes failed/skipped, return a compact failure summary instead of `"(no graph output)"`.

---

## Concurrency Policy

Use a level/ready-queue scheduler.

Defaults:

- `maxConcurrency = args.maxConcurrency ?? team.limits.maxConcurrency ?? 4`
- `maxConcurrency` must be a positive integer.
- `maxConcurrency: 1` gives deterministic sequential behavior.
- Ready nodes may run in parallel up to the limit.
- Scheduling order is by `team.agentBindings` order.
- Result ordering is independent of completion order.

Cancellation:

- Parent `ctx.signal` aborts the graph controller.
- Running children receive abort.
- Pending nodes become `cancelled` or `skipped` with explicit reason.

Timeout:

- Per-node timeout from `args.timeoutMs ?? team.limits.timeoutMs`.
- Timeout produces failed node result with `error: "cancelled"` or `error: "timeout"` consistently; prefer `"timeout"` if the graph timer caused the abort.

---

## P3 Session State Integration

After P3 lands, `runTeamGraph` should emit common `pi-teams:run` deltas through the P3 state writer.

Minimum events:

```ts
interface GraphRunStarted {
  kind: "graph-run-started";
  runId: string;
  teamId: string;
  prompt: string;
  roles: string[];
  edges: TeamGraphEdge[];
  startedAt: number;
}

interface GraphNodeStarted {
  kind: "graph-node-started";
  runId: string;
  role: string;
  model: string;
  startedAt: number;
}

interface GraphNodeFinished {
  kind: "graph-node-finished";
  runId: string;
  role: string;
  status: GraphNodeStatus;
  ok: boolean;
  durationMs: number;
  error?: string;
  outputPreview?: string;
}

interface GraphRunFinished {
  kind: "graph-run-finished";
  runId: string;
  ok: boolean;
  outputRoles: string[];
  durationMs: number;
  completedAt: number;
}
```

State guidance:

- Store compact deltas, not repeated full snapshots.
- Use bounded `outputPreview` unless P3 defines artifact storage.
- Preserve enough metadata for reload/resume/fork inspection.
- `team-handlers.ts` should pass `stateManager`/P3 writer into `runTeamGraph`.

---

## Implementation Touch Points

### `extensions/pi-teams/team-graph.ts`

Replace the current sequential topological loop with:

- `validateTeamGraph(team)`
- topological level/ready-queue scheduler
- deterministic upstream packaging
- deterministic output reduction
- concurrency cap
- per-node timeout and parent abort handling
- injectable runner for tests
- P2 prompt resolver calls
- P3 state event hooks
- compact `GraphRunResult`

Suggested result shape:

```ts
interface GraphNodeResult {
  role: string;
  binding: TeamAgentBinding;
  status: GraphNodeStatus;
  ok: boolean;
  run?: ModelRun;
  output: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

interface GraphRunResult {
  id: string;
  output: string;
  ok: boolean;
  nodes: GraphNodeResult[];
  roots: string[];
  sinks: string[];
}
```

### `extensions/pi-teams/team-types.ts`

Add minimal policy fields listed above.

Do not add a large DSL.

### `extensions/pi-teams/team-handlers.ts`

Graph handler should:

- call `runTeamGraph`
- pass:
  - `stateManager` / P3 writer,
  - runtime timeout,
  - runtime max concurrency if added later,
  - UI progress callback
- return details with:
  - graph run id,
  - node statuses,
  - node models,
  - durations,
  - output roles,
  - `ok`

Keep existing non-graph handlers until P4/P5 protocol lowering is explicitly implemented.

### `docs/teams-future-improvements-todo.md`

Update P5 after implementation with:

- status,
- validation behavior,
- concurrency default,
- remaining deferred items:
  - protocol-to-graph lowering,
  - custom reducers,
  - threshold continuation policies.

---

## Tests

### DAG validation tests

Add focused tests for `validateTeamGraph`:

1. accepts valid chain `a -> b -> c`;
2. accepts valid fanout/join `a -> b`, `a -> c`, `b -> d`, `c -> d`;
3. rejects unknown `from`;
4. rejects unknown `to`;
5. rejects duplicate roles;
6. rejects self edge;
7. rejects duplicate edge;
8. rejects cycle;
9. rejects disconnected graph;
10. rejects unknown `graph.outputs`;
11. rejects unsupported reducer;
12. rejects missing model;
13. derives sinks when outputs absent.

### Execution tests

Use injected fake runner; do not spawn `pi`.

1. Executes chain in dependency order.
2. Executes fanout nodes concurrently.
3. Honors `maxConcurrency: 1`.
4. Produces deterministic output order despite out-of-order completion.
5. Packages only direct upstream outputs.
6. Skips dependent nodes after failed upstream with default `require-ok`.
7. Runs dependent node with failed upstream when `allow-failed`.
8. Returns `ok: false` when any node fails/skips.
9. Handles parent abort.
10. Handles per-node timeout.
11. Emits progress messages in deterministic lifecycle points.

### P2 integration tests

With fake resolver or fixture prompt ids:

1. graph node uses the graph protocol contract's default node template slot;
2. team-level prompt override is used;
3. binding `templateId` overrides team/default;
4. binding/subagent system prompt resolution is used;
5. unknown prompt id fails before any node launches.

### P3 integration tests

With fake state writer:

1. emits graph run started;
2. emits node started/finished for each node;
3. emits skipped node event;
4. emits final graph finished event;
5. events contain bounded output preview, not full repeated snapshots.

### Handler tests

1. `graphHandler` passes `stateManager` into `runTeamGraph`.
2. handler details include node statuses and graph run id.
3. UI status updates include team id and node role.
4. validation error surfaces clearly through `team_run`.

---

## Non-Goals for P5

- No arbitrary reducer plugins.
- No looping graph execution.
- No unbounded retry policy; P5 supports only bounded per-node retries for transient child-call failures.
- No threshold joins yet.
- No full protocol lowering until P4 schema is settled.
- No graph visualization UI beyond existing describe/detail surfaces.
