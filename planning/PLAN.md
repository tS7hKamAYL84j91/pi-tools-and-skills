# Plan: Panopticon — Next Steps

**Date:** 2026-04-04
**Status:** Active
**Source:** Review of research corpus (T-056, T-058, T-073, T-074, T-075, T-076, Kim et al. 2025)

---

## Priority 1: Brief Template Enforcement

Highest-impact change for agent output quality. Kim et al. showed architecture-task alignment matters more than agent count. The T-056 brief template exists but isn't enforced.

- [ ] 1.1 Make `Task Classification` a mandatory field in BRIEF.md (Sequential / Parallelisable / High-entropy search / Tool-heavy)
- [ ] 1.2 Enforce classification check before spawning agents — sequential tasks go to SAS (single agent), parallelisable to Centralised MAS
- [ ] 1.3 Include success criteria and explicit scope boundaries in every brief

**Why:** Incorrectly parallelised sequential tasks degrade performance by 39–70% (Kim et al.). A well-structured brief eliminates the most common source of agent output failure.

---

## Priority 2: Model Routing

Remove rate limits as a bottleneck by routing tasks to appropriate models.

- [ ] 2.1 Route scouts and research tasks to Gemini Flash (100× TPM headroom vs Anthropic Sonnet)
- [ ] 2.2 Route simple edits and boilerplate to Haiku
- [ ] 2.3 Keep Sonnet for standard implementation, Opus for hard architecture decisions
- [ ] 2.4 Single large-context agent (Gemini Pro 1M) for whole-codebase analysis — don't split across parallel scouts

**Why:** All workers on Sonnet concentrates TPM in one rate-limit bucket. Gemini Flash has ~4M TPM vs Sonnet's ~40K.

---

## Priority 3: Task Classification Router

Prevent the 39–70% degradation Kim et al. measured on incorrectly-parallelised sequential tasks.

- [ ] 3.1 Apply the 45% test: if a single Sonnet agent can solve it at >45% accuracy, don't add agents
- [ ] 3.2 Never use Independent MAS without cross-validation (17.2× error amplification)
- [ ] 3.3 Sequential tasks (code, debug, config): single agent always
- [ ] 3.4 Parallelisable tasks (research, analysis, scanning): Centralised MAS with WIP=3

**Why:** Adding agents to the wrong task type is actively harmful regardless of rate limits.

---

## Priority 4: Spawn Depth Enforcement

- [ ] 4.1 Check `PI_SUBAGENT_DEPTH >= PI_SUBAGENT_MAX_DEPTH` before spawning — return error if exceeded
- [ ] 4.2 Currently env vars are set but not enforced in spawner.ts

---

## Priority 5: Backpressure Signal

- [ ] 5.1 Expose `pendingMessages` count via `agent_peek` (already partially done)
- [ ] 5.2 Orchestrator should check inbox depth before sending — if N > 2, wait for drain
- [ ] 5.3 Prevents context fragmentation from multiple simultaneous followUp injections

---

## Priority 6: Registry Caching (When Needed)

- [ ] 6.1 Cache peer records with TTL = heartbeat interval (5s)
- [ ] 6.2 Only re-scan `~/.pi/agents/` directory on cache miss
- [ ] 6.3 Not urgent at current scale (<20 agents), needed at 50+

---

## Deferred: Beads Topology for PA

Reserve the Beads (linear pipeline) topology for personal assistant workflows. Do not apply to CoAS research orchestration where Centralised MAS is correct.

- [ ] Each pipeline stage (intent-parser, planner, researcher, synthesiser) as a bead
- [ ] Inter-bead channels use Maildir queues (same infrastructure)
- [ ] No central orchestrator — user-interface bead heads the chain

---

## Not Building

- ❌ EventBridge / PubSub broker — overkill for <10 agents, adds daemon dependency
- ❌ Erlang/OTP actors — wrong problem (our bottleneck is LLM TPM, not message throughput)
- ❌ MCP for inter-agent messaging — MCP is for external tools, not agent coordination
- ❌ Full Beads topology for CoAS — Centralised MAS is correct for parallel research tasks
- ❌ Socket transport re-add — Maildir at turn boundaries is fast enough (30–60s LLM turns)
