# P3 Mini-Spec: Move `pi-teams` Run State into Pi Session Tree

## Goal

Persist all `pi-teams` run state as Pi session custom entries so team runs naturally follow session tree behavior: reload, resume, fork, `/tree` navigation, and compaction.

Replace legacy global run-state authority from:

```text
~/.pi/agent/councils/*.json
```

with session-scoped custom entries:

```ts
pi.appendEntry("pi-teams:run", event)
```

Legacy files remain readable/importable but must not be treated as the primary state source.

---

## Design Principles

1. **Session branch is source of truth.**
   - Rehydrate from current session branch first.
   - Never globally merge all legacy council files into every session.

2. **Protocol-abstract state.**
   - Store generic run/phase/node events.
   - Do not bake council-only statuses into the primary schema.

3. **Append deltas, not snapshots.**
   - Avoid repeatedly persisting full `CouncilDeliberation` objects.
   - Store each model/node output once, with size bounds.

4. **Extension state is not model context.**
   - Use `pi.appendEntry()` custom entries for state.
   - Do not add `custom_message`/visible LLM context entries by default.

---

## Event Schema

Add in `extensions/pi-teams/state.ts`.

```ts
export const TEAM_RUN_CUSTOM_TYPE = "pi-teams:run";
export const LEGACY_COUNCIL_CUSTOM_TYPE = "pi-teams:deliberation";

export type TeamRunEventKind =
  | "run_started"
  | "phase_started"
  | "node_started"
  | "node_completed"
  | "phase_completed"
  | "run_completed"
  | "run_failed"
  | "run_cancelled"
  | "run_tombstoned"
  | "legacy_imported";

export interface TeamRunEventBase {
  schemaVersion: 1;
  kind: TeamRunEventKind;
  runId: string;
  seq: number;
  timestamp: number;
  orchestratorPid: number;
}

export interface TeamRunStartedEvent extends TeamRunEventBase {
  kind: "run_started";
  teamId: string;
  protocol: string;
  teamSource?: string;
  input: {
    prompt: string;
    files?: string[];
    specPath?: string;
  };
  models?: Record<string, string | string[]>;
  limits?: Record<string, number>;
}

export interface TeamRunPhaseStartedEvent extends TeamRunEventBase {
  kind: "phase_started";
  phaseId: string;
  label: string;
}

export interface TeamRunNodeStartedEvent extends TeamRunEventBase {
  kind: "node_started";
  phaseId?: string;
  nodeId: string;
  role: string;
  label?: string;
  model?: string;
  agentRef?: string;
  promptRefs?: {
    systemPromptId?: string;
    templateId?: string;
  };
  config?: {
    tools?: string[];
    parameters?: Record<string, string | number | boolean>;
  };
}

export interface TeamRunNodeCompletedEvent extends TeamRunEventBase {
  kind: "node_completed";
  phaseId?: string;
  nodeId: string;
  ok: boolean;
  durationMs: number;
  output?: string;
  outputChars: number;
  outputSha256: string;
  outputTruncated: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface TeamRunPhaseCompletedEvent extends TeamRunEventBase {
  kind: "phase_completed";
  phaseId: string;
  ok: boolean;
  durationMs?: number;
  error?: string;
}

export interface TeamRunCompletedEvent extends TeamRunEventBase {
  kind: "run_completed";
  ok: true;
  durationMs: number;
  summary?: string;
  details?: Record<string, unknown>;
}

export interface TeamRunFailedEvent extends TeamRunEventBase {
  kind: "run_failed";
  ok: false;
  durationMs?: number;
  error: string;
}

export interface TeamRunCancelledEvent extends TeamRunEventBase {
  kind: "run_cancelled";
  reason: string;
}

export interface TeamRunTombstonedEvent extends TeamRunEventBase {
  kind: "run_tombstoned";
  reason?: string;
}

export interface TeamRunLegacyImportedEvent extends TeamRunEventBase {
  kind: "legacy_imported";
  source: "legacy-council-json" | "legacy-session-deliberation";
  sourcePath?: string;
  legacyVersion?: number;
}

export type TeamRunEvent =
  | TeamRunStartedEvent
  | TeamRunPhaseStartedEvent
  | TeamRunNodeStartedEvent
  | TeamRunNodeCompletedEvent
  | TeamRunPhaseCompletedEvent
  | TeamRunCompletedEvent
  | TeamRunFailedEvent
  | TeamRunCancelledEvent
  | TeamRunTombstonedEvent
  | TeamRunLegacyImportedEvent;
```

### Output bounding

Add a module constant:

```ts
const MAX_PERSISTED_OUTPUT_CHARS = 64_000;
```

For `node_completed` and `run_completed.summary`:

- Persist at most `MAX_PERSISTED_OUTPUT_CHARS`.
- Always include:
  - `outputChars`
  - `outputSha256`
  - `outputTruncated`

This bounds session bloat while preserving inspectability and integrity.

---

## Rehydration Semantics

Add a generic state manager, either replacing or backing the current `CouncilStateManager`.

Recommended shape:

```ts
export class TeamRunStateManager {
  rehydrateFromSession(sessionManager: SessionManagerLike): void;
  startRun(...): string;
  appendEvent(event: Omit<TeamRunEvent, "schemaVersion" | "seq" | "timestamp" | "orchestratorPid">): void;
  get(runId: string): TeamRunRecord | undefined;
  list(): TeamRunRecord[];
  findOrphans(): TeamRunRecord[];
  markFailed(runId: string, reason: string): void;
  remove(runId: string): void; // append tombstone
}
```

Keep `CouncilStateManager` as a compatibility adapter during P3 so existing debate code/tests can migrate incrementally.

### Restore algorithm

On rehydrate:

1. Read current branch entries in root-to-leaf order.
2. Filter entries:
   - `entry.type === "custom"`
   - `entry.customType === "pi-teams:run"` or legacy `pi-teams:deliberation`
3. Reduce `pi-teams:run` events by `runId`, `seq`.
4. Convert old session `pi-teams:deliberation` snapshots into in-memory records for compatibility.
5. Do not append migration events during plain rehydrate; rehydrate must be idempotent.
6. Compute next sequence per run as `max(seq) + 1`.

Use current branch, not all session entries, for default `get/list/findOrphans`. This is what gives `/tree` and fork correct semantics.

---

## Legacy Migration Strategy

### Sources

1. Legacy global JSON files:

```text
~/.pi/agent/councils/{id}.json
```

2. Existing session custom snapshots:

```ts
customType: "pi-teams:deliberation"
```

### Strategy

- **Primary path:** session `pi-teams:run` entries.
- **Compatibility path:** old session `pi-teams:deliberation` snapshots.
- **Legacy file path:** readable/importable fallback only.

Do **not** auto-import every `~/.pi/agent/councils/*.json` into every session on startup. Legacy files lack reliable cwd/session ownership and would contaminate forked/resumed sessions.

### Lazy import behavior

Import a legacy council JSON only when:

- `get(id)` misses in current session and a matching legacy file exists.
- `findOrphans({ includeLegacy: true })` or equivalent explicitly asks for legacy fallback.
- A future user command/tool explicitly imports legacy history.

When importing a legacy `CouncilDeliberation`, append normalized `pi-teams:run` events to the current session:

1. `legacy_imported`
2. `run_started`
3. `phase_started` / `node_completed` events for:
   - generation
   - critiques
   - synthesis
4. terminal event:
   - `run_completed` for completed records
   - `run_failed` for failed records
   - leave non-terminal if still in progress or orphan candidate

Never delete legacy JSON during P3. Optionally mark imported in memory to avoid duplicate imports within the same process; session entries prevent duplicate imports across reload once present.

### Legacy mapping

| Legacy `CouncilDeliberation` | New schema |
|---|---|
| `id` | `runId` |
| `council` | `teamId` |
| protocol | `"debate"` |
| `prompt` | `run_started.input.prompt` |
| `members[]` | generation/critiquing nodes |
| `chairman` | synthesis node |
| `generation[]` | `node_completed` with `phaseId: "generation"` |
| `critiques[]` | `node_completed` with `phaseId: "critique"` |
| `synthesis` | `node_completed` with `phaseId: "synthesis"` |
| `status: completed` | `run_completed` |
| `status: failed` | `run_failed` |

---

## Session Lifecycle Semantics

### `session_start`

Register in `extensions/pi-teams/index.ts`:

```ts
pi.on("session_start", async (event, ctx) => {
  stateManager.rehydrateFromSession(ctx.sessionManager);
});
```

Behavior by reason:

- `startup`: restore current session branch.
- `reload`: restore same branch; no duplicate writes.
- `resume`: restore target session branch only.
- `fork`: restore entries copied into forked session only.
- `new`: empty/new session; do not inherit old state except entries explicitly seeded by Pi.

### `session_shutdown`

Clear volatile references only. Do not append anything unless a run is actively being cancelled/failed by P3 logic.

### `/tree` navigation

Also register:

```ts
pi.on("session_tree", async (_event, ctx) => {
  stateManager.rehydrateFromSession(ctx.sessionManager);
});
```

This makes run history follow the active branch inside the same session file.

### Fork semantics

Forked sessions contain only entries on the forked path. Therefore:

- Runs completed after the fork point are not inherited.
- Runs started before the fork point but incomplete at the fork point may appear non-terminal.
- `findOrphans()` should flag non-terminal runs only when `orchestratorPid` is dead.

### New session semantics

A new session starts with no team state unless explicitly initialized by Pi’s session setup. Do not import global legacy state automatically.

---

## Compaction Concerns

- `pi.appendEntry()` custom entries do not participate in LLM context.
- Compaction should not remove or summarize `pi-teams:run` entries.
- Rehydration after compaction must still see earlier custom entries on the branch.
- Do not add user-facing `custom_message` entries by default.
- Team result tool messages already provide user/model-visible summaries.
- If a future protocol needs model-visible run summaries, add explicit opt-in `custom_message` entries, not hidden coupling to state events.

Add a test proving:

1. Custom run events before a compaction entry still rehydrate.
2. No extra `custom_message` entries are emitted by default.
3. Repeated updates do not re-store prior large outputs.

---

## Implementation Touch Points

### `extensions/pi-teams/state.ts`

- Add `TEAM_RUN_CUSTOM_TYPE`.
- Add event interfaces and reducer.
- Add `TeamRunStateManager`.
- Keep `CouncilStateManager` compatibility adapter or migrate callers carefully.
- Add legacy JSON reader/importer.
- Convert `remove()` to append `run_tombstoned` for session-backed mode.
- Keep legacy file persistence only behind compatibility option; default should prefer session entries.

### `extensions/pi-teams/index.ts`

- Instantiate session-backed state manager.
- Register:
  - `session_start`
  - `session_tree`
  - optionally `session_shutdown`
- Keep existing `before_provider_request`.

Expected registration smoke test event list should include:

```ts
[
  "before_provider_request",
  "session_start",
  "session_tree",
  "session_shutdown" // if used
]
```

### `extensions/pi-teams/team-runtime.ts`

- Start one run in `runTeam()` before dispatch.
- Pass `runId`/state handle into handlers.
- On success append `run_completed`.
- On thrown error append `run_failed`, then rethrow.
- Keep `ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready")` in `finally`.

### `extensions/pi-teams/team-handlers.ts`

- Add run state to `TeamHandlerRunArgs`.
- Emit generic phase/node events for:
  - debate
  - pair-coding
  - consult
  - telephone
  - graph
- Store effective P1/P2 metadata where available:
  - model
  - tools
  - parameters
  - prompt/template ids
- Do not persist provider-specific payloads.

### `extensions/pi-teams/deliberation.ts`

- Replace snapshot-style `create/update` calls with explicit phase/node events, or route them through the compatibility adapter.
- Debate phases:
  - `generation`
  - `critique`
  - `synthesis`

### `extensions/pi-teams/pair-coding.ts`

- Add optional callbacks:
  - `onPhaseStart`
  - `onNodeStart`
  - `onNodeComplete`
- Emit per phase:
  - navigator brief
  - driver implementation
  - navigator review
  - driver fix pass

### `extensions/pi-teams/team-graph.ts`

- Emit node events per graph role.
- Keep graph executor protocol-abstract: node role/edges, not hardcoded debate/pair terms.

### `docs/teams-future-improvements-todo.md`

- Update P3 status once implemented.
- Document migration behavior:
  - session-first
  - lazy legacy import
  - no automatic global import

---

## Tests

### State unit tests

File: `tests/council-state.test.ts` or new `tests/team-run-state.test.ts`.

Required:

1. Appends `pi-teams:run` events instead of `pi-teams:deliberation` snapshots.
2. Reduces run events into a `TeamRunRecord`.
3. Maintains per-run sequence across rehydrate.
4. `remove()` appends tombstone and hides run from `list()`.
5. Output truncation stores hash, original char count, and truncated flag.
6. Orphan detection uses non-terminal status plus dead `orchestratorPid`.

### Legacy migration tests

1. Reads old `~/.pi/agent/councils/{id}.json`.
2. Converts legacy council record to normalized run events.
3. Does not auto-import unrelated legacy files on `session_start`.
4. Does not duplicate import after session already has same `runId`.
5. Corrupt legacy JSON is ignored or surfaced as a warning without crashing.

### Lifecycle tests

1. `session_start/startup` rehydrates current branch.
2. `session_start/reload` is idempotent.
3. `session_start/resume` replaces in-memory state with resumed session state.
4. `session_start/fork` sees only entries copied into forked path.
5. `session_start/new` starts empty.
6. `session_tree` rehydrates active branch after navigation.

### Protocol instrumentation tests

Mock child calls; assert emitted events for:

1. Debate:
   - run started
   - generation nodes
   - critique nodes
   - synthesis node
   - run completed/failed
2. Pair-coding:
   - navigator brief
   - driver implementation
   - review/fix pass nodes
3. Pair-consult:
   - single navigator node
4. Telephone:
   - one node per relay hop
5. Graph:
   - one node per graph role in execution order

### Compaction tests

Using synthetic session entries:

1. Run events before compaction entry still restore.
2. Compaction entry does not alter run reducer.
3. No model-visible custom messages are emitted by default.
4. Repeated updates grow linearly by new events, not by full prior snapshots.

### Registration tests

Update `tests/extension-registration.test.ts` expected `pi-teams` lifecycle hooks.

---

## Acceptance Criteria

- `pi-teams` run state survives reload and resume.
- Forked sessions do not inherit unrelated global council state.
- `/tree` branch navigation switches visible run state to the active branch.
- Legacy council JSON files remain readable/importable.
- Pair, council, telephone, consult, and graph runs share one protocol-abstract state schema.
- Session file bloat is bounded by delta events and output truncation.
- `npm run check` and `npm test` pass.
