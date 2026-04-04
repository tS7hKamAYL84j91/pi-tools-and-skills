# Plan: Panopticon — Next Steps

**Date:** 2026-04-04
**Status:** Active

---

## Design Principle: Separation of Concerns

Panopticon does exactly four things. Orchestration policy (model routing, topology selection, task classification) lives **outside** the extension.

| Concern | Modules |
|---|---|
| **Spawn** | `spawner.ts`, `spawner-utils.ts` |
| **Lifecycle** | `registry.ts`, `index.ts` |
| **Observe** | `peek.ts`, `ui.ts` |
| **Communicate** | `messaging.ts` |

---

## Done

- [x] **TaskBrief schema** — `lib/task-brief.ts` enforces classification, goal, successCriteria (minItems:1), scope at the spawn boundary via TypeBox validation
- [x] **Brief rendering** — `renderBriefAsPrompt()` converts structured brief to agent prompt; classification is infrastructure metadata, not shown to agent
- [x] **Inbox wake** — `fs.watch` on Maildir `new/` wakes idle agents instantly; verified with 10-round ping-pong (avg ~5s round-trip)
- [x] **Policy stripped** — removed BRIEF.md reading, REPORT.md→done inference, model routing, topology mismatch warnings from extension
- [x] **spawnChild extraction** — moved to `spawner-utils.ts` to stay under 500-line architecture limit

---

## Priority 1: Spawn Depth Enforcement

- [ ] 1.1 Check `PI_SUBAGENT_DEPTH >= PI_SUBAGENT_MAX_DEPTH` before spawning — return error if exceeded
- [ ] 1.2 Currently env vars are set in `spawnChild()` but never checked in `spawn_agent`

---

## Priority 2: Orchestration Layer (outside extension)

Model routing, topology selection, and task classification belong in an orchestration layer, not in panopticon. This is where the tree topology lives.

- [ ] 2.1 Orchestrator agents (Opus/Gemini Pro) spawn and coordinate downstream agents
- [ ] 2.2 Model routing: orchestrator picks model per task (Flash for scouts, Sonnet for implementation, Haiku for boilerplate)
- [ ] 2.3 Topology selection: orchestrator decides single-agent vs centralised-mas based on classification
- [ ] 2.4 Results flow back up the tree to the root agent
- [ ] 2.5 Visibility scoping: agents see parent + siblings, not parent's siblings (tree isolation)

---

## Priority 3: Backpressure Signal

- [ ] 3.1 Expose `pendingMessages` count via `agent_peek` (already partially done)
- [ ] 3.2 Orchestrator should check inbox depth before sending — if N > 2, wait for drain
- [ ] 3.3 Prevents context fragmentation from multiple simultaneous followUp injections

---

## Priority 4: Registry Caching (When Needed)

- [ ] 4.1 Cache peer records with TTL = heartbeat interval (5s)
- [ ] 4.2 Only re-scan `~/.pi/agents/` directory on cache miss
- [ ] 4.3 Not urgent at current scale (<20 agents), needed at 50+

---

## Priority 5: Soak Test Isolation

- [ ] 5.1 `tests/soak.test.ts` has 2 flaky failures when run in full suite (passes in isolation)
- [ ] 5.2 Likely test-ordering / shared state issue — needs investigation

---

## Not Building (in the extension)

- ❌ Model routing in spawner — orchestration policy, not infrastructure
- ❌ Topology enforcement in spawner — orchestration policy, not infrastructure
- ❌ BRIEF.md / REPORT.md conventions — workflow semantics, not agent lifecycle
- ❌ EventBridge / PubSub broker — overkill for <10 agents, adds daemon dependency
- ❌ Erlang/OTP actors — wrong problem (bottleneck is LLM TPM, not message throughput)
- ❌ MCP for inter-agent messaging — MCP is for external tools, not agent coordination
- ❌ Socket transport — Maildir + fs.watch is fast enough (instant wake, ~5s LLM turn)
