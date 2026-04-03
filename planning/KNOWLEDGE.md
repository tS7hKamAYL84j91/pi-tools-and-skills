# Knowledge Base

## Architecture: Current State

### Three extensions provide agent infrastructure:
1. **pi-panopticon.ts** (612 LOC) — Agent registry, monitoring, `agent_peek` tool, socket server, UI widget/overlay
2. **pi-messaging.ts** (252 LOC) — `agent_send`, `agent_broadcast` tools, maildir inbox delivery
3. **pi-subagent.ts** (555 LOC) — `spawn_agent`, `rpc_send`, `list_spawned`, `kill_agent`

### Shared library layer (lib/):
- `agent-registry.ts` (95 LOC) — `AgentRecord` type, `readAllAgentRecords()`, `writeAgentRecord()`, `onAgentCleanup()`
- `message-transport.ts` (64 LOC) — `MessageTransport` interface (DI boundary)
- `transports/maildir.ts` (190 LOC) — `MaildirTransport` (atomic write via tmp/→new/)
- `session-log.ts` (90 LOC) — `readSessionLog()`, `formatSessionLog()` (reads pi JSONL)
- `tool-result.ts` (22 LOC) — `ok()`, `fail()` helpers

### Agent registry (`~/.pi/agents/`)
- Each agent writes `{id}.json` with: id, name, pid, cwd, model, socket, startedAt, heartbeat, status, task, pendingMessages, sessionDir, sessionFile
- Agent id format: `{pid}-{random}` (e.g. `22130-mni1cqda`)
- Stale threshold: 30 seconds (`STALE_MS`)
- Dead agents reaped on every `readAllRecords()` call

### Pi session logs
- Pi writes session JSONL to `~/.pi/agent/sessions/{encoded-cwd}/{timestamp}_{uuid}.jsonl`
- `agent_peek` reads these via `readSessionLog()` — no custom activity log needed
- Subagents get sessions via `--session-dir ~/.pi/agent/sessions/subagents/{name}/`

### Pi extension auto-discovery
- `settings.json` has `"extensions": ["/Users/jim/git/tools-and-skills/extensions"]`
- Pi discovers `extensions/*.ts` (single file) and `extensions/*/index.ts` (directory)
- After merge: `extensions/pi-agents/index.ts` replaces three `extensions/*.ts` files
- Pi will see it as one extension

### Operational coupling (pre-merge)
1. **Concurrent writes**: Both panopticon and messaging write full JSON to `{id}.json`. Last `writeFileSync` wins.
2. **Load-order race**: Messaging's `session_start` does `readAllAgentRecords().find(r => r.pid === process.pid)` — returns undefined if panopticon hasn't written the record yet.
3. **Implicit cleanup**: Panopticon reaps dead agents → `runAgentCleanup()` → messaging's hook cleans inbox. If panopticon not loaded, inboxes never cleaned.
4. **Assumed co-loading**: Spawned subagents self-register via panopticon. Without panopticon globally, spawned agents are invisible to `agent_peek`/`agent_send`.
5. **Cross-extension data**: `pendingMessages` field in `AgentRecord` — written by messaging, read/displayed by panopticon.

### Test infrastructure
- Vitest, 4 test files, 91 tests
- `panopticon-pure.test.ts` — tests exported pure functions (classifyRecord, buildRecord, formatAge, nameTaken, pickName, sortRecords, formatSessionLog, readSessionLog, agentCleanupPaths)
- `pi-messaging.test.ts` — mocks `lib/agent-registry.js` and transports, tests tool execute + command handler + inbox drain + cleanup hooks
- `pi-subagent.test.ts` — tests pure helpers (formatEvent, recentOutputFromEvents, buildArgList)
- `maildir-transport.test.ts` — mocks `node:fs`, tests send/receive/ack/prune/init/pendingCount/cleanup

### Key constraint: createMessagingExtension factory
Messaging uses a factory pattern `createMessagingExtension(config)` that returns `(pi: ExtensionAPI) => void`. This allows injecting mock transports in tests. The factory pattern should be preserved but adapted — instead of returning a full extension function, it should return a module setup function that takes a `Registry` reference.

### Pi extension API relevant details
- `pi.on("session_start")` — fired on initial session load, ctx has sessionManager
- `pi.on("session_shutdown")` — fired on exit (Ctrl+C, Ctrl+D, SIGTERM)
- `pi.on("agent_start")` / `pi.on("agent_end")` — fired per user prompt
- `pi.on("model_select")` — fired when model changes
- `pi.on("input")` — fired when user input received
- `pi.registerTool()` — works during load AND after startup
- `pi.registerCommand()` — duplicate names get numeric suffixes
- `pi.registerShortcut()` — keyboard shortcut registration
- `ctx.sessionManager.getSessionDir()` / `getSessionFile()` — session JSONL location
- `pi.sendUserMessage()` — inject user messages (used by messaging inbox drain)
- `pi.appendEntry()` — persist extension state (not used by these extensions currently)
