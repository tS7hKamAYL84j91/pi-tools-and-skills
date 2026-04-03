# Improvements Plan — tools-and-skills

**Created:** 2026-04-03  
**Priority:** Fix 3 lint issues + 1 test failure, then improve architecture and testing

---

## Phase 1: Immediate Fixes (Day 1)

### 1.1 Fix Lint Warnings (3 issues)

**Socket Constructor** — `extensions/pi-agents/socket.ts:29`
- Remove empty `constructor() {}` 
- Properties already initialized inline
- Task: 1 line deletion

**Non-Null Assertion** — `extensions/pi-agents/registry.ts:321`
- Replace `this.record!` with `this.record?.cwd ?? "/"`
- Even though guarded by `if (!this.record) return`, optional chaining is safer
- Task: 1 character edit

**Export Type** — `extensions/pi-agents/types.ts:8`
- Change `export { type MessageTransport }` → `export type { MessageTransport }`
- Cleaner, follows Biome rule
- Task: Add `type` keyword

**Commits:**
```bash
git commit -m "fix: remove unnecessary constructor and lint warnings

- Socket: remove empty constructor
- Registry: use optional chaining instead of non-null assertion
- Types: use export type for MessageTransport
"
```

---

### 1.2 Fix Test Failure (agent_broadcast mock)

**File:** `tests/pi-messaging.test.ts:198`  
**Issue:** Mock `readAllPeers` not overridable after module creation

**Fix:** Recreate messagingModule after updating mock
```typescript
it("reports no peers when registry is empty", async () => {
    mockRegistry.readAllPeers.mockReturnValue([SELF]);
    // Recreate module so it sees updated mock
    messagingModule = createMessaging({ send: sendTransport, broadcast: broadcastTransport })(
        api as unknown as ExtensionAPI,
        mockRegistry,
    );
    const result = await executeTool("agent_broadcast", { message: "hi" });
    expect(getText(result)).toContain("No peer agents");
});
```

**Verify:**
```bash
npm test  # Should show 91/91 passing
```

---

## Phase 2: Code Quality (Week 1)

### 2.1 Add Integration Tests

**Goal:** Test the full pi-agents lifecycle, not just individual modules

**New Test File:** `tests/pi-agents-lifecycle.test.ts`

**Coverage:**
1. **Session Start Lifecycle**
   - registry.register() called
   - socket.start() succeeds
   - messaging.init() drains inbox
   - ui.start() if hasUI

2. **Agent Event Handling**
   - `agent_start` → setStatus("running")
   - `agent_end` → setStatus("waiting") + drainInbox
   - `model_select` → updateModel

3. **Shutdown Lifecycle**
   - spawner.shutdownAll() aborts subagents
   - messaging.drainInbox() cleans up
   - socket.stop() closes server
   - registry.unregister() removes record

4. **Error Resilience**
   - socket.start failure → continues
   - drainInbox with no messages → ok
   - unregister on non-existent record → ok

**Tests:** ~20-25 tests covering happy path + error cases

---

### 2.2 Documentation

**Create `docs/ARCHITECTURE.md`**
- Overview of the 3-in-1 extension structure
- Module responsibilities (registry, socket, messaging, spawner, peek, ui)
- Data flow diagram (message lifecycle, agent discovery, spawner communication)
- Registry interface design

**Update `docs/TESTING.md`**
- How to mock ExtensionAPI, Registry, MessageTransport
- Pure function vs integration test patterns
- Running single test file: `npm test -- pi-messaging.test.ts`

**Update `README.md`** (if minimal currently)
- Brief intro to the agent system
- Quick start: spawn agents, send messages, peek

---

## Phase 3: Architecture Improvements (Weeks 2-3)

### 3.1 Eliminate Legacy Extension Files

**Status:** Currently have both new (`extensions/pi-agents/`) and old (`extensions/pi-*.ts`) files

**Action:**
- Delete `extensions/pi-panopticon.ts` (1412 LOC → registry.ts 337 LOC)
- Delete `extensions/pi-messaging.ts` (252 LOC → messaging.ts 249 LOC)
- Delete `extensions/pi-subagent.ts` (555 LOC → spawner.ts 560 LOC)
- Verify in `settings.json` that `extensions: ["/path/to/extensions"]` auto-discovers only new files

**Test:** `npm run check && npm test` still green

**Commit:**
```bash
git commit -m "refactor: remove legacy extension files

All functionality merged into extensions/pi-agents/ directory structure.
- Removed pi-panopticon.ts, pi-messaging.ts, pi-subagent.ts
- pi-agents/index.ts is now the single entry point
"
```

---

### 3.2 Registry Caching Strategy

**Current:** `readAllPeers()` reads from disk every call

**Problem:** On every `agent_peek`, `agent_broadcast`, or UI render, we re-read all `{id}.json` files

**Solution:** In-memory peer cache with TTL
```typescript
// registry.ts additions:
private peerCache: AgentRecord[] | null = null;
private peerCacheTTL = 1000; // 1 second
private lastPeerRead = 0;

readAllPeers(forceRefresh = false): AgentRecord[] {
    const now = Date.now();
    if (!forceRefresh && this.peerCache && now - this.lastPeerRead < this.peerCacheTTL) {
        return this.peerCache;
    }
    // Read from disk, reap dead, return
    this.peerCache = _readAllPeers();
    this.lastPeerRead = now;
    return this.peerCache;
}
```

**Impact:** UI renders at 60Hz won't thrash disk; messaging commands stay fast

**Test:** Verify cache hit/miss behavior in unit tests

---

### 3.3 Heartbeat Optimization

**Current:** Each agent writes its own record every 5 seconds

**Problem:** With N agents, we write N files every 5 seconds. Disk churn.

**Solution (Optional):** Batch heartbeat updates
- Every agent still writes its own heartbeat
- But only if status/task/model changed (skip no-op writes)
- Consider: shared heartbeat list that agents read/append atomically

**Impact:** Reduce disk I/O by ~80% for idle agents

**Complexity:** Medium — requires careful file locking

---

## Phase 4: Enhanced Features (Weeks 3-4)

### 4.1 Agent Aliases

**Feature:** Named shortcuts for common peer agents
- `/alias alice prod-runner-1` → remember as "alice"
- `agent_send alice hello` → goes to "prod-runner-1"
- Stored in `~/.pi/agent/aliases.json`

**Implementation:**
- New module: `extensions/pi-agents/aliases.ts`
- Command: `/alias name target-regex` — creates entry
- Tool: `agent_alias_list` — shows all aliases
- Modify `resolvePeer()` in messaging to check aliases first

**Impact:** Better UX for frequent inter-agent communication

---

### 4.2 Agent Health Monitoring

**Feature:** Detect and report agent issues
- Agent: "waiting" for >5 minutes (stuck?)
- Agent: "running" for >1 hour (infinite loop?)
- Agent: heartbeat stalled (crashed?)

**Implementation:**
- Scoring function: `agentScore(record) → "healthy" | "slow" | "dead"`
- Display in `/agents` overlay with warning emoji 🟡
- Tool: `agent_health` — detailed report

**Impact:** Easier to spot problematic agents in large deployments

---

### 4.3 Message Ordering & ACK Tracking

**Feature:** Guaranteed delivery with ack tracking
- When `agent_send` succeeds, log ack ref
- Tool: `agent_ack_pending` — show unacked messages across all agents
- Periodic prune of old messages (>1 day)

**Implementation:**
- Extend MessageTransport with `acknowledgments()` method
- Track in messaging.ts: `{ from, to, message, sentAt, ackedAt?, ref }`
- MaildirTransport: store ack receipts in `.ack/` subdir

**Impact:** Reliable agent-to-agent orchestration

---

## Phase 5: Testing & Polish (Weeks 4-5)

### 5.1 Stress Tests

**Tests:** High-concurrency scenarios
- 10 agents all broadcasting simultaneously
- Inbox with 1000+ messages, drain performance
- Socket server under 100 concurrent connections
- Registry with 100 dead agents mixed in

**Tools:** `npm run test:stress` (separate from `npm test`)

---

### 5.2 Documentation Polish

- **examples/agent-to-agent-messaging.md** — detailed walkthrough
- **docs/message-flow.md** — ASCII diagram of send/broadcast/inbox paths
- **docs/registry-design.md** — why single Registry instance, trade-offs
- **docs/spawner-lifecycle.md** — fork, heartbeat, RPC, graceful shutdown

---

### 5.3 Linting & Style Enforcement

- Pre-commit hook: `npm run check` + `npm test`
- Update `.gitignore` to exclude generated files
- Add `.prettierrc` if needed (currently using Biome)

---

## Phase 6: Optimization & Scale (Weeks 5-6)

### 6.1 Performance Profiling

**Profile:**
- agent_peek with 100 peers (session log reading)
- agent_broadcast to 50 targets (socket overhead)
- Registry heartbeat with 10,000 agents (theoretical)

**Tools:**
```bash
npm run profile  # Node --inspect, flame graphs
```

---

### 6.2 Caching & Indexing

- Cache formatted agent names for quick lookup
- Index records by name for O(1) resolve instead of O(n) scan
- Consider: SQLite-backed registry for very large deployments

---

## Timeline

| Phase | Duration | Tasks |
|-------|----------|-------|
| 1: Fixes | 1 day | Lint, test mock, verify |
| 2: Quality | 3-4 days | Integration tests, docs |
| 3: Arch | 4-5 days | Delete legacy, cache, heartbeat |
| 4: Features | 5-7 days | Aliases, health, ACK tracking |
| 5: Testing | 3-4 days | Stress tests, doc polish |
| 6: Optimize | 3-4 days | Profiling, indexing |
| **Total** | **~4 weeks** | Full pipeline to production-ready |

---

## Success Criteria

- [x] Phase 1: All tests passing, zero lint warnings
- [ ] Phase 2: Integration tests cover 90%+ of edge cases
- [ ] Phase 3: Single entry point, no legacy files, sub-second reads for <100 agents
- [ ] Phase 4: At least 2 new features (aliases + health)
- [ ] Phase 5: Stress tests confirm 100+ agents, 1000+ messages
- [ ] Phase 6: <100ms peer discovery, <200ms broadcast to 50 targets
- [ ] Documentation: docs/ folder complete, README updated, examples included

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Merge conflicts in Phase 3 (delete legacy) | Branch early, merge Phase 2 tests first |
| Performance regression | Benchmark before/after each phase |
| Message loss during ACK refactor | Comprehensive test coverage first |
| Large registry slowness | Add profiling in Phase 5 before scale testing |

---

## Deliverables by Phase

**Phase 1:** `git commit` with fixes  
**Phase 2:** `CODE_REVIEW.md` → `ARCHITECTURE.md`, `TESTING.md`  
**Phase 3:** Deleted files, updated `settings.json`  
**Phase 4:** New modules + commands, integration tests  
**Phase 5:** Stress test suite, final docs  
**Phase 6:** Performance benchmarks, optimization PR  

