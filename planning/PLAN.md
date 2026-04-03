# Plan: Merge Three Extensions into One

## Goal
Consolidate `pi-panopticon.ts`, `pi-messaging.ts`, and `pi-subagent.ts` into a single `extensions/pi-agents/` directory extension with separate modules. Eliminate operational coupling: load-order races, concurrent record writes, implicit cleanup hooks, and the assumption that panopticon is loaded for messaging/subagent to work.

## Current State
- 3 separate extensions in `extensions/` (~1,420 LOC)
- 5 shared libs in `lib/` (~460 LOC)
- 4 test files (~1,060 LOC), 91 tests passing
- Loaded via `settings.json` → `"extensions": ["/Users/jim/git/tools-and-skills/extensions"]`
- Pi auto-discovers `extensions/*.ts` and `extensions/*/index.ts`

## Target Structure
```
extensions/pi-agents/
├── index.ts              # Single entry point — orchestrates lifecycle
├── registry.ts           # Agent registration, heartbeat, dead-agent reaping
├── socket.ts             # Unix socket server (peek protocol)
├── messaging.ts          # agent_send, agent_broadcast, /send, inbox drain
├── spawner.ts            # spawn_agent, rpc_send, list_spawned, kill_agent
├── peek.ts               # agent_peek tool
├── ui.ts                 # Widget, /agents overlay, /alias, status
└── types.ts              # Shared interfaces (Registry, SpawnedAgent, etc.)

lib/                      # Keep as-is (already clean)
├── agent-registry.ts     # AgentRecord type, file IO, cleanup hooks
├── message-transport.ts  # MessageTransport interface
├── session-log.ts        # Session JSONL reader
├── tool-result.ts        # ok()/fail() helpers
└── transports/
    └── maildir.ts        # MaildirTransport implementation
```

Pi will discover `extensions/pi-agents/index.ts` as a single extension. The three old files are deleted.

## Tasks

### Phase 1: Create extension directory and entry point
- [ ] 1.1 Create `extensions/pi-agents/` directory
- [ ] 1.2 Create `extensions/pi-agents/types.ts` — shared interfaces:
  - `Registry` interface (getRecord, heartbeat, register, unregister, readAll, updateField)
  - `SpawnedAgent` type (moved from pi-subagent.ts)
  - Re-export `AgentRecord`, `AgentStatus` from `lib/agent-registry.ts`
- [ ] 1.3 Create `extensions/pi-agents/index.ts` — single `export default function(pi)`:
  - Creates one `Registry` instance (single record, single write path)
  - Wires lifecycle: `session_start` → registry.register → messaging.init → ui.start
  - Wires shutdown: `session_shutdown` → spawner.shutdownAll → messaging.flush → ui.stop → registry.unregister
  - Wires agent events: `agent_start` / `agent_end` → registry.setStatus
  - Wires `model_select` → registry.updateModel
  - Wires `input` → registry.setTask
  - Passes registry reference to all modules (no PID scan needed)

### Phase 2: Extract registry module
- [ ] 2.1 Create `extensions/pi-agents/registry.ts`:
  - Move from panopticon: `classifyRecord`, `buildRecord`, `formatAge`, `nameTaken`, `pickName`, `sortRecords`, `agentCleanupPaths`
  - New `Registry` class:
    - Holds the single `AgentRecord` in memory
    - Single `flush()` method writes to `~/.pi/agents/{id}.json`
    - `register(ctx)` — creates record, writes it, starts heartbeat timer
    - `unregister()` — stops heartbeat, removes record file
    - `setStatus(status)` / `updateModel(model)` / `setTask(task)` / `updatePendingMessages(count)` — mutate + flush
    - `readAllPeers()` — reads all records, reaps dead ones, runs cleanup hooks
  - Heartbeat timer lives here (was in panopticon)
  - Dead-agent reaping + `runAgentCleanup` calls live here
- [ ] 2.2 Export pure functions for tests (same as current panopticon exports)

### Phase 3: Extract socket module
- [ ] 3.1 Create `extensions/pi-agents/socket.ts`:
  - Move from panopticon: socket server start/stop, `handleSocketCommand`
  - Constructor takes `Registry` reference (for session file lookup)
  - `start(socketPath)` / `stop()` methods

### Phase 4: Extract messaging module
- [ ] 4.1 Create `extensions/pi-agents/messaging.ts`:
  - Move from pi-messaging.ts: `agent_send` tool, `agent_broadcast` tool, `/send` command
  - Constructor takes `Registry` reference (no more `getSelfRecord()` PID scan)
  - `init(registry)` — init transport, drain inbox
  - `drainInbox()` — reads messages, delivers via `pi.sendUserMessage`, updates pending count via `registry.updatePendingMessages()`
  - `flush()` — final drain on shutdown
  - Register cleanup hook: `onAgentCleanup(id => transport.cleanup(id))`
  - Keep `createMessagingExtension` factory pattern for testability (inject transport)

### Phase 5: Extract spawner module
- [ ] 5.1 Create `extensions/pi-agents/spawner.ts`:
  - Move from pi-subagent.ts: `spawn_agent`, `rpc_send`, `list_spawned`, `kill_agent` tools
  - Move pure helpers: `formatEvent`, `recentOutputFromEvents`, `buildArgList`, `defaultSubagentSessionDir`
  - `shutdownAll()` — sends abort to all spawned agents (called from index.ts shutdown)
  - Agents map stays local to this module

### Phase 6: Extract peek module
- [ ] 6.1 Create `extensions/pi-agents/peek.ts`:
  - Move from panopticon: `agent_peek` tool
  - Takes `Registry` reference for `readAllPeers()` and self-id

### Phase 7: Extract UI module
- [ ] 7.1 Create `extensions/pi-agents/ui.ts`:
  - Move from panopticon: widget rendering, `/agents` overlay, `/alias` command, status line, `Ctrl+Shift+O` shortcut
  - Move pure functions: `buildPowerlineSegments`, `renderPowerlineWidget`, `STATUS_SYMBOL`, `STATUS_LABEL`, `STATUS_COLOR`, `PL_SEP`, `PL_SEP_THIN`
  - `start(ctx, registry)` — start widget refresh timer
  - `stop()` — clear widget timer, clear status
  - `refreshWidget()` — reads from registry, renders powerline

### Phase 8: Update tests
- [ ] 8.1 Update `tests/panopticon-pure.test.ts`:
  - Change imports from `../extensions/pi-panopticon.js` to `../extensions/pi-agents/registry.js`
  - Same pure function tests, just new import paths
- [ ] 8.2 Update `tests/pi-messaging.test.ts`:
  - Change imports from `../extensions/pi-messaging.js` to `../extensions/pi-agents/messaging.js`
  - Update mock structure if `createMessagingExtension` signature changes
  - Add test: messaging gets registry reference directly (no PID scan on init)
- [ ] 8.3 Update `tests/pi-subagent.test.ts`:
  - Change imports from `../extensions/pi-subagent.ts` to `../extensions/pi-agents/spawner.js`
  - Same pure function tests
- [ ] 8.4 `tests/maildir-transport.test.ts` — no changes needed (tests lib/, not extensions)
- [ ] 8.5 Add integration test: lifecycle ordering
  - Verify registry.register called before messaging.init
  - Verify messaging.flush called before registry.unregister on shutdown
- [ ] 8.6 All tests passing (target: 91+ tests)

### Phase 9: Delete old files and verify
- [ ] 9.1 Delete `extensions/pi-panopticon.ts`
- [ ] 9.2 Delete `extensions/pi-messaging.ts`
- [ ] 9.3 Delete `extensions/pi-subagent.ts`
- [ ] 9.4 Run `npm test` — all tests pass
- [ ] 9.5 Run `npm run check` — typecheck + lint pass
- [ ] 9.6 Manual smoke test: `pi` loads, `/agents` works, `agent_peek` works, spawn + send works

## Key Design Decisions

### Single record, single write path
The `Registry` class holds one `AgentRecord` in memory. All mutations (heartbeat, status, pending count, model, task) go through `registry.updateField()` → `flush()`. No more two extensions writing the same JSON file concurrently.

### Explicit lifecycle ordering in index.ts
```
session_start:  registry.register → socket.start → messaging.init → ui.start
session_shutdown: spawner.shutdownAll → messaging.flush → socket.stop → ui.stop → registry.unregister
```
No load-order ambiguity. Messaging always gets a valid registry reference.

### Keep lib/ unchanged
`lib/agent-registry.ts`, `lib/message-transport.ts`, `lib/transports/maildir.ts`, `lib/session-log.ts`, `lib/tool-result.ts` stay as-is. They're already clean, dependency-inverted, and well-tested. The refactor is about the extensions layer, not the library layer.

### Keep createMessagingExtension factory for testability
The messaging module still accepts injected transports. Tests mock transports the same way. The only change is that messaging gets a `Registry` reference instead of doing a PID scan.

### Pure functions stay exported for tests
`classifyRecord`, `buildRecord`, `formatAge`, `pickName`, `sortRecords`, `formatEvent`, `recentOutputFromEvents`, `buildArgList` etc. all remain exported from their new module locations. Tests update import paths only.

## Risks
- **Import path changes**: Every test file needs updated imports. Grep carefully.
- **settings.json auto-discovery**: Pi discovers `extensions/*/index.ts` — verify `pi-agents/index.ts` is found and the three old `.ts` files are gone.
- **Circular imports**: `types.ts` must not import from modules that import from it. Keep it leaf-level.
- **Messaging factory test structure**: If `createMessagingExtension` now takes a `Registry` param, test mocks need updating.
