# Refactor Report — `extensions/pi-subagent.ts`

## Before / After

| Metric | Before | After |
|---|---|---|
| Extension lines | 598 | 565 |
| Net lines removed | — | −33 (extension) |
| New test lines | 0 | +170 |
| Tests | 39 (none for subagent) | 60 (21 new) |

---

## 1. Deletion Log

| Removed | Reason |
|---|---|
| `setInterval` polling in `rpcCall` | Replaced by EventEmitter listener — zero-lag, no 100 ms tick overhead |
| 7-branch `if/return` chain in `recentOutput` | Replaced by `EVENT_FORMATTERS` lookup table |
| Nested `setTimeout` inside `new Promise` in `kill_agent` | Replaced by `Promise.race([closed, sleep(2000)])` |
| ~15 repetitions of `{ content: [{ type: "text" as const, text: … }], details: … }` | Replaced by `ok()` / `fail()` helpers |
| `recentOutput(agent, n)` accepting a full `SpawnedAgent` | Replaced by `recentOutputFromEvents(events, n)` taking a plain `string[]` |

---

## 2. Purity Report

| Function | Before | After |
|---|---|---|
| `formatEvent(line)` | Inlined inside closure, reads `evt.*` via 7 branches | Pure module-level fn; input→output, no state |
| `recentOutputFromEvents(events, lines)` | Depended on `SpawnedAgent` object | Pure — `string[] → string` |
| `buildArgList(params)` | Inlined in `spawn_agent` execute (mixed with file I/O) | Pure — `ArgParams → string[]`; file I/O stays in execute |
| `sleep(ms)` | n/a | Pure timer utility |
| `ok(text, details)` / `fail(text, details)` | n/a | Pure ToolResult constructors |

Side-effects remain at the edges: process spawn, tempDir creation, `rpcWrite` stdin write, `proc.kill`.

---

## 3. Key Structural Changes

### `rpcCall` — event-driven instead of polling

**Before:**
```ts
const poller = setInterval(() => {
  // scan recentEvents array every 100 ms
  for (let i = eventsBefore; i < agent.recentEvents.length; i++) { … }
}, 100);
```

**After:** `SpawnedAgent` gains an `EventEmitter` field. Every line pushed to `recentEvents` also triggers `agent.emitter.emit("line", line)`. `rpcCall` subscribes with `.on` and unsubscribes with `.off` in `finish()`:
```ts
const onLine = (line: string) => { /* check for response/agent_end */ };
agent.emitter.on("line", onLine);
// finish() calls: clearTimeout(timer); agent.emitter.off("line", onLine);
```
Response latency drops from ≤100 ms (poll interval) to ~0 ms.

### `kill_agent` — flat graceful shutdown

**Before:** nested `setTimeout` inside `setTimeout` inside `new Promise`.

**After:**
```ts
rpcWrite(agent, { type: "abort" });
const closed = new Promise<void>((res) => agent.proc.once("close", res));
await Promise.race([closed, sleep(2000)]);
if (!agent.done) {
  agent.proc.kill("SIGTERM");
  await Promise.race([closed, sleep(2000)]);
  if (!agent.done) agent.proc.kill("SIGKILL");
}
```

### `recentOutput` — table-driven

**Before:** 7 `if (t === "…") return …` branches.

**After:**
```ts
const EVENT_FORMATTERS: Record<string, (e: Evt) => string> = {
  message_update: (e) => …,
  tool_execution_start: (e) => …,
  // …
};
export function formatEvent(line: string): string {
  const fmt = EVENT_FORMATTERS[String(evt.type ?? "?")];
  return fmt ? fmt(evt) : `  [${evt.type ?? "?"}]`;
}
```
Adding a new event type is a one-liner table entry.

---

## 4. Test Results

```
Test Files  8 passed (8)
     Tests  60 passed (60)
  Duration  ~220ms
```

21 new characterisation tests cover:
- `formatEvent` — all 8 event types + non-JSON + truncation
- `recentOutputFromEvents` — empty, normal, lines-limit
- `buildArgList` — all flag combinations

---

## 5. Interface Stability

All four public tool names, parameters, and behaviour are **unchanged**:
- `spawn_agent` — identical parameters and output format
- `rpc_send` — identical parameters and output format
- `list_spawned` — identical parameters and output format
- `kill_agent` — identical parameters and output format
