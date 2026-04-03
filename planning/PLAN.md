# Plan: Decouple agent_peek from transport

## Goal
Make `agent_peek` read from pi's native session JSONL instead of a panopticon-internal activity maildir. This removes the transport assumption and means peek works regardless of how messaging is wired.

## Tasks

### Phase 1: AgentRecord gets session info
- [x] 1.1 Add `sessionDir?: string` and `sessionFile?: string` to `AgentRecord` in `lib/agent-registry.ts`
- [x] 1.2 In panopticon's registration, populate from `ctx.sessionManager.getSessionDir()` and `ctx.sessionManager.getSessionFile()`

### Phase 2: Subagents always get sessions
- [x] 2.1 In `pi-subagent.ts`, default `sessionDir` to `~/.pi/agent/sessions/subagents/{name}/` instead of `--no-session`

### Phase 3: agent_peek reads session JSONL
- [x] 3.1 Write `readSessionLog()` — reads session JSONL, flattens content blocks into events
- [x] 3.2 Write `formatSessionLog()` — compact `[HH:MM:SS] event_type key=value` format
- [x] 3.3 `agent_peek` tool reads `peer.sessionFile` from AgentRecord
- [x] 3.4 `/agents` overlay detail view reads session JSONL
- [x] 3.5 Socket `peek` command returns session events

### Phase 4: Move inbox count ownership to messaging
- [x] 4.1 Add `pendingCount(agentId): number` to `MessageTransport` interface
- [x] 4.2 Implement in `MaildirTransport`
- [x] 4.3 Messaging extension writes `pendingMessages` to AgentRecord
- [x] 4.4 Remove `inboxCapable` from `AgentRecord`
- [x] 4.5 Remove `inboxPendingCount()` from `lib/agent-registry.ts`
- [x] 4.6 Panopticon reads `pendingMessages` from record — no transport knowledge

### Phase 5: Remove panopticon activity maildir
- [x] 5.1 Remove `maildirWrite()`, `maildirRead()`, `formatMaildirEntries()`, `entryExtras()`, `MaildirEntry` type
- [x] 5.2 Remove `emit()` function and all calls (agent_start, agent_end, tool_call, tool_result, message_received, session_start)
- [x] 5.3 Remove `selfMaildir` variable
- [x] 5.4 Remove activity dir cleanup on shutdown
- [x] 5.5 Remove `tool_call` and `tool_result` event handlers (pi session JSONL captures these)

### Phase 6: Update tests
- [x] 6.1 Replace `formatMaildirEntries` tests with `formatSessionLog` + `readSessionLog` tests
- [x] 6.2 Update subagent tests for default session dirs
- [x] 6.3 Update messaging tests for `pendingCount()` on transport
- [x] 6.4 All 76 tests passing

## Ownership summary
| Concern | Owner | Storage |
|---------|-------|---------|
| Agent registry (who's alive) | panopticon | `~/.pi/agents/{id}.json` |
| Activity log (what happened) | pi core | `~/.pi/agent/sessions/…/*.jsonl` |
| Message delivery | messaging ext | transport-dependent (maildir: `~/.pi/agents/{id}/inbox/`) |
| Pending message count | messaging ext | writes to AgentRecord, panopticon reads |
| Observing peers | panopticon | reads AgentRecord + session JSONL |
