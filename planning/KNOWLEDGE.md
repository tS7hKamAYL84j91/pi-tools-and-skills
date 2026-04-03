# Knowledge Base

## Architecture: Current State

### Three extensions provide agent infrastructure:
1. **pi-panopticon.ts** — Agent registry, monitoring, activity log, `agent_peek` tool
2. **pi-messaging.ts** — `agent_send`, `agent_broadcast` tools, maildir inbox delivery
3. **pi-subagent.ts** — `spawn_agent`, `rpc_send`, `list_spawned`, `kill_agent`

### Agent registry (`~/.pi/agents/`)
- Each agent writes `{id}.json` with: id, name, pid, cwd, model, socket, startedAt, heartbeat, status, task
- Agent id format: `{pid}-{random}` (e.g. `22130-mni1cqda`)
- No sessionId or sessionDir in AgentRecord

### Panopticon activity log (THE PROBLEM)
- Panopticon writes its own activity maildir at `~/.pi/agents/{agent-id}/`
- Files like `1775229679437-0439-tool_result.json` with `{ts, event, tool, summary, ...}`
- `agent_peek` reads from this panopticon-internal maildir
- This is a **custom activity log that duplicates session data** and couples peek to maildir

### Pi session logs (THE ANSWER)
- Pi always writes session JSONL to `~/.pi/agent/sessions/{encoded-cwd}/{timestamp}_{uuid}.jsonl`
- Encoded cwd: `--Users-jim-git-tools-and-skills--` (replace `/` with `-`, wrap in `--`)
- Encoding function: `getDefaultSessionDir()` in session-manager.js
- Session JSONL header: `{type: "session", version: 3, id: uuid, timestamp, cwd}`
- Events: `message` (user/assistant/toolResult), `model_change`, `thinking_level_change`
- Tool calls appear as content blocks inside assistant messages: `{type: "toolCall", name, arguments}`
- Rich data: full LLM responses, usage stats, timestamps

### ExtensionContext provides:
- `ctx.sessionManager: ReadonlySessionManager` with:
  - `getSessionId()` — UUID of current session
  - `getSessionDir()` — directory path
  - `getSessionFile()` — path to the .jsonl file
  - `getCwd()` — working directory
  - `getBranch()` — current branch entries
  - `getEntries()` — all entries

### Subagent sessions
- `spawn_agent` with no `sessionDir` param uses `--no-session` → **no JSONL written**
- `spawn_agent` with `sessionDir` param writes JSONL to that directory
- For peek to work on subagents, we need them to have sessions

### Key insight
- If AgentRecord stored `sessionDir` and `sessionFile`, then `agent_peek` could read the session JSONL directly
- No dependency on any transport or custom activity log format
- Pi already writes the data — we just need to find it

### Matching agent → session
- Option A: Add `sessionDir` + `sessionFile` to AgentRecord (panopticon writes it on register)
- Option B: Derive from cwd using `getDefaultSessionDir(cwd)` + find most recent .jsonl
- Option A is cleaner — the agent knows its own session

### `--no-session` subagents
- Currently invisible to peek (no session file)
- Fix: always pass `--session-dir` when spawning subagents
- The subagent extension already supports `sessionDir` param — just make it default instead of optional

### Inbox count bleeds transport into registry
- `AgentRecord` has `inboxCapable?: boolean` and `pendingMessages?: number`
- Panopticon calls `inboxPendingCount(selfId)` which does `readdirSync(…/inbox/new/)` — hardcoded maildir
- Messaging extension (`pi-messaging.ts`) doesn't even use these fields
- Panopticon bypasses the transport interface entirely to get the count
- `MessageTransport` has `receive()` (returns messages) but no `pendingCount()`
- The registry should not know **how** messages are stored

### Fix: pendingCount on MessageTransport
- Add `pendingCount(agentId: string): number` to `MessageTransport` interface
- The messaging extension knows its transport — it should expose the count
- Panopticon should ask messaging for the count, or messaging should publish it
- Options:
  - A: Add `pendingCount()` to `MessageTransport`, messaging extension sets a field panopticon can read
  - B: Messaging extension updates AgentRecord.pendingMessages itself during heartbeat
  - C: Use pi's `EventBus` — messaging publishes count, panopticon subscribes
- Option B is simplest: messaging owns the count, writes it to the record. Panopticon just reads the field without knowing where it came from.
- Remove `inboxCapable` (if there's a transport, there's a transport) and `inboxPendingCount()` from agent-registry.ts
