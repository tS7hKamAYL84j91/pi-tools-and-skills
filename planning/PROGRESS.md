# Progress Log

## 2026-04-03 22:55 — Plan written for extension merge

Analyzed all three extensions (`pi-panopticon.ts`, `pi-messaging.ts`, `pi-subagent.ts`) and their shared libraries. Identified operational coupling:

1. **Concurrent record writes** — panopticon + messaging both `writeFileSync` to the same `{id}.json`
2. **Load-order race** — messaging's `session_start` does PID scan that fails if panopticon hasn't registered yet
3. **Implicit cleanup hooks** — messaging registers via `onAgentCleanup`, panopticon reaps dead agents
4. **Assumed co-loading** — subagent spawns processes that are invisible without panopticon
5. **Cross-extension data flow** — `pendingMessages` computed by messaging, displayed by panopticon

Plan: merge into `extensions/pi-agents/` with modules: `index.ts`, `registry.ts`, `socket.ts`, `messaging.ts`, `spawner.ts`, `peek.ts`, `ui.ts`, `types.ts`. Keep `lib/` as-is. 9 phases, ~30 tasks.

Current state: 91 tests passing, 1,420 LOC in extensions, 460 LOC in lib, 1,060 LOC in tests.
