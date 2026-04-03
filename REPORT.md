# T-122 Report: Messaging Self-Identity Caching

## What Was Done

### Problem
`getSelfRecord()` in `extensions/pi-messaging.ts` called `readAllAgentRecords().find(r => r.pid === process.pid)` on every invocation — an O(n) filesystem scan reading every `.json` file in `~/.pi/agents/`. With 9+ call sites (resolvePeer, peerNames, drainInbox, updatePendingCount, session_start, agent_broadcast, getSelfName, etc.), a single `agent_send` previously triggered **3 filesystem scans**; a full `session_start` triggered **4+**.

### TDD Process

**Red** — Added 3 failing tests in `tests/pi-messaging.test.ts` under `describe("self-record caching")`:
1. After `session_start`, each subsequent `agent_send` should add exactly 1 `readAllAgentRecords` call (peer resolution only).
2. With a warm cache, `agent_send` triggers exactly 1 `readAllAgentRecords` call total.
3. When self-record is absent at `session_start` (panopticon not yet registered), messaging handles gracefully and retries the PID scan on the next operation.

Both count-based tests failed as expected (got 7 calls where 5 were expected; got 3 where 1 was expected).

**Green** — Three targeted changes to `extensions/pi-messaging.ts`:

1. **Added `cachedSelf` state variable** (`let cachedSelf: AgentRecord | undefined`) alongside the existing `selfName` cache.

2. **Updated `getSelfRecord()`** to return the cached record immediately on subsequent calls, and populate the cache on first successful PID scan:
   ```typescript
   function getSelfRecord(): AgentRecord | undefined {
       if (cachedSelf) return cachedSelf;
       const record = readAllAgentRecords().find((r) => r.pid === process.pid);
       if (record) cachedSelf = record;
       return record;
   }
   ```

3. **Updated `session_start` handler** to eagerly populate `cachedSelf` with a single scan, so all downstream helpers (`updatePendingCount`, `drainInbox`, `getSelfName`, `resolvePeer`, `peerNames`) return from the cache with zero additional filesystem reads:
   ```typescript
   pi.on("session_start", async () => {
       cachedSelf = readAllAgentRecords().find((r) => r.pid === process.pid);
       if (cachedSelf) {
           config.send.init(cachedSelf.id);
           updatePendingCount();
           drainInbox();
       }
   });
   ```

4. **Updated `updatePendingCount()`** to assign `cachedSelf = self` after writing, keeping the cache consistent with the persisted record.

### Why `resolvePeer` Didn't Need Changing
`resolvePeer` calls `getSelfRecord()` (now cached, 0 scans) then `readAllAgentRecords()` (1 scan for peer lookup). With a warm cache this is already exactly 1 scan. Replacing `getSelfRecord()` with a raw `cachedSelf?.id` access would break self-exclusion in the cold-cache path (e.g., "does not send to self" test when session_start hasn't fired).

### Result

| Scenario | Before | After |
|---|---|---|
| `session_start` scans | 4+ | 1 |
| `agent_send` scans (warm) | 3 | 1 |
| `agent_broadcast` scans (warm) | 2 | 1 |
| Self-exclusion when cold | ✓ | ✓ |
| Retry when not found at start | ✓ | ✓ |

## Test Results

```
Test Files  4 passed (4)
     Tests  87 passed (87)   ← was 84 before (3 new caching tests added)
  Duration  ~320ms
```

`npx tsc --noEmit` — no errors.

## Files Modified

- `extensions/pi-messaging.ts` — added `cachedSelf` variable, updated `getSelfRecord()`, `updatePendingCount()`, and `session_start` handler
- `tests/pi-messaging.test.ts` — added `describe("self-record caching")` block with 3 new tests
