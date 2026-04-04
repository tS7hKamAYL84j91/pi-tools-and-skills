# Knowledge Base

## Panopticon Architecture (as of 2026-04-04)

### Current Stack
- **Extension:** `extensions/pi-panopticon/` — 8 modules, ~1,900 LOC
- **Shared lib:** `lib/` — agent-registry, message-transport, maildir transport, session-log, tool-result
- **Transport:** Maildir only (atomic tmp/ → new/ rename, at-least-once delivery)
- **Registry:** `~/.pi/agents/{id}.json` — heartbeat 5s, stale threshold 30s, dead-agent reaping on read
- **Coordination:** Kanban board.log (POSIX O_APPEND) + COMMUNICATION.md

### Architecture Grade: Solid
The three-layer design (coordination → registry → transport) is clean. Centralised MAS topology is correct per Kim et al. (2025). Zero-dependency, human-observable, crash-safe.

### Key Empirical Facts (Kim et al. 2025)
- Centralised MAS: +80.8% on parallelisable tasks, 4.4× error containment
- Independent MAS: 17.2× error amplification — never use without cross-validation
- Sequential tasks: ALL MAS variants degrade −39% to −70% vs single agent
- Capability saturation: if single agent >45% accuracy, adding agents yields negative returns
- MAS consumes 15× more tokens than single agent on equivalent tasks
- Results hold across OpenAI, Google, Anthropic families (CV < 0.02)

### Rate Limits
- Anthropic Sonnet: ~40K TPM → supports WIP=3
- Gemini Flash: ~4M TPM → supports 15–20 concurrent agents
- WIP=3 is validated as the Sonnet ceiling

### Validated: 10-Agent Telephone Game (2026-04-04)
- 10 agents chained via Maildir `agent_send`, zero message loss
- ~50s end-to-end, ~5s per hop (LLM turn dominates)
- `fs.watch` instant wake confirmed — idle agents process messages immediately
- Agent naming: `basename(cwd)` drives registry name; unique cwds needed for distinct names
- Clean spawn, communicate, shutdown cycle across all 10

### Known Issues
- **No double-delivery risk** (socket transport removed, Maildir-only now)
- **Sub-ms ordering undefined** — same-ms messages sort by UUID not insertion order (low severity)
- **pendingMessages 5s lag** — cosmetic, no delivery impact
- **Registry scan O(N)** — fine at <20 agents, cache at 50+
- **No idempotency keys** — duplicate logical sends both delivered (acceptable for conversational, risky for automation)
- **Spawn depth not tracked** — env vars removed (YAGNI). Add depth guard when orchestration layer introduces tree topologies
- **Soak tests stable** — previously flaky, now pass reliably in full suite (resolved)

### Transport Decision
Sockets removed in favour of Maildir-only. Messages delivered at turn boundaries (agent_end). This is correct: any transport faster than LLM turn time (~30-60s) is equivalent. Durability beats latency.

### What Not to Build
EventBridge, Erlang actors, MCP for inter-agent, full Beads for CoAS — all assessed and rejected. See T-073 REPORT.md for full rationale.
