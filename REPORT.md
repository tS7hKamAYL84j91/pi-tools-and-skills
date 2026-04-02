# Refactor Report: `extensions/pi-messaging.ts`

## Summary

Reduced `extensions/pi-messaging.ts` from **388 → 335 lines** (−53 lines, −14%) by eliminating three categories of duplication, adding 26 characterisation tests, and committing in three atomic steps.

---

## 1. Deletion Log

| Removed | Reason |
|---|---|
| `mkdirSync` import from `node:fs` | No longer called directly |
| `REGISTRY_DIR` import from `agent-registry` | `ensureInbox()` encapsulates the path |
| Manual dir-creation loop in `durableWrite()` (`existsSync` + `mkdirSync` × 3) | Duplicated `ensureInbox()` from `agent-registry.ts` |
| `metadata?` parameter on `durableWrite()` | Speculative/YAGNI — never used at any call site |
| `findSelfId()` standalone helper | Merged into `getSelfRecord()` usage |
| 3× copies of the socket-try + inbox-fallback pattern | Replaced by shared `socketOrInbox()` / `inboxPlusSocket()` |
| Repeated `textResult(...)` peer-not-found blocks in `agent_send` and `agent_send_durable` | Replaced by `notFound()` helper |
| `const sockPath = peer.socket` intermediate variable | Inlined |
| `const allPeers` / `const targets` split in broadcast | Merged to `const peers` / `const targets` |

---

## 2. Purity Report

| Function | Was | Now |
|---|---|---|
| `durableWrite()` | Side-effectful + duplicate dir setup | Side-effectful but minimal — delegates dirs to `ensureInbox()` |
| `truncate()` | Inlined as expression in each send path | **Pure function** extracted to module top |
| `textResult()` | Already pure | Unchanged |
| `socketOrInbox()` | Did not exist | Pure logic + async I/O at edge |
| `inboxPlusSocket()` | Did not exist | Pure logic + async I/O at edge |
| `notFound()` | Did not exist | **Pure** helper — no side effects |
| `getSelfRecord()` | Called `readAllAgentRecords()` | Unchanged — used consistently everywhere now |

---

## 3. Before / After Line Counts

```
Before:  388 lines  (extensions/pi-messaging.ts)
After:   335 lines  (extensions/pi-messaging.ts)
         −53 lines  (−14%)

New:     369 lines  (tests/pi-messaging.test.ts)  — characterisation tests
```

---

## 4. Key Structural Changes

### `durableWrite()` — removes duplicate inbox dir creation (Step 1)

**Before:**
```typescript
const inboxBase = join(REGISTRY_DIR, targetId, "inbox");
const tmpDir    = join(inboxBase, "tmp");
const newDir    = join(inboxBase, "new");
for (const dir of [tmpDir, newDir, join(inboxBase, "cur")]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
```

**After:**
```typescript
const inboxBase = ensureInbox(targetId); // creates tmp/, new/, cur/ idempotently
```

`ensureInbox()` in `agent-registry.ts` already does exactly this; the duplication was a latent bug (different codepath, same semantics, must be kept in sync).

---

### Shared delivery core — eliminates 3× copied socket+inbox pattern (Step 2)

**Before** — three send paths each had ~20 lines of identical structure:
```typescript
// In agent_send:
if (sockPath && existsSync(sockPath)) {
    try { const resp = await socketSend(...); if (resp.ok) return textResult(...); }
    catch { }
}
const writeResult = durableWrite(...);
if (writeResult.ok) return textResult("queued...", ...);
return textResult("failed...", ...);

// In agent_send_durable: (similar but order inverted)
// In /send command:      (similar, using ui.notify instead of textResult)
```

**After** — two named delivery functions, each ~10 lines:
```typescript
/** Best-effort: try socket first; only write inbox on failure */
async function socketOrInbox(peer, from, text): Promise<DeliveryResult>

/** Durable: always write inbox first; also try socket for low latency */
async function inboxPlusSocket(peer, from, text): Promise<DeliveryResult>
```

Each send path becomes a 3-branch result-check (10–15 lines) instead of nested try/catch logic.

---

## 5. Test Results

All tests pass at every commit point. No regressions.

```
Test Files  8 passed (8)
     Tests  65 passed (65)   (39 pre-existing + 26 new characterisation tests)
```

### New characterisation tests cover:
- `agent_send`: peer not found, socket success (no inbox write), socket throws (inbox fallback), no socket (inbox fallback), both fail, no self-send
- `agent_send_durable`: peer not found, write failure, always-inbox, socket+durable, inbox-only
- `agent_broadcast`: no peers, filter no match, all peers summarised, filter applied
- `/send command`: bad args, peer not found, socket+inbox, inbox-only
- Inbox draining: `session_start` drains + calls ensureInbox, `agent_end` drains, no self record = no-op

---

## 6. Commits

| Hash | Message |
|---|---|
| `a13334a` | `refactor(messaging): durableWrite uses ensureInbox() instead of duplicating dir creation` |
| `a19a2eb` | `refactor(messaging): extract socketOrInbox/inboxPlusSocket; eliminate repeated delivery logic across 3 send paths` |
| `2049e0d` | `refactor(messaging): use getSelfRecord() in drainInbox and event handlers; eliminate duplicated pid lookup` |

---

## 7. Interface Stability

All public contracts preserved unchanged:
- Tool names: `agent_send`, `agent_send_durable`, `agent_broadcast`
- All tool parameters: identical schemas
- `/send` command: identical usage and output messages
- `promptGuidelines` / `description` strings: unchanged
- Inbox drain behaviour: identical (session_start + agent_end)
