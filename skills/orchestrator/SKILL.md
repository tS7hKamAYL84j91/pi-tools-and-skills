---
name: orchestrator
description: >
  Multi-agent orchestration protocols: task classification, topology selection,
  briefing, monitoring, messaging, and model routing. Grounded in 58 research
  reports from the CoAS research programme. Use when coordinating multiple agents,
  decomposing complex work, or deciding single-agent vs multi-agent topology.
triggers:
  - orchestrat
  - multi-agent
  - spawn worker
  - task decomposition
  - topology
  - centralised MAS
  - briefing protocol
  - model selection
  - coordinate agents
---

# Orchestrator Skill

> Portable orchestration protocols for pi-based multi-agent systems.
> Every major instruction is cross-referenced to empirical research.

---

## 1. Philosophy

1. **Pi is the engine.** Do not rebuild the loop, LLM adapter, session management, or compaction.
2. **Errors are sensors.** Non-zero exits and stack traces are data. Read stderr, pivot. [R-ERR]
3. **Filesystem is state.** If it's not written down, it didn't happen. [R-DUR, R-KAN]
4. **No plans, just steps.** One action → observe → next action.
5. **Stay nano.** No databases, no frameworks. Markdown and pi.
6. **Orchestrators never implement.** The lead coordinates; all work is delegated. [R-COASE]

---

## 2. Roles

### 2.1 Lead Orchestrator

The orchestrator is the only agent that talks to the human.

**NEVER:**
- Read/edit/write files outside its own directory
- Implement code, write tests, or do research directly
- Explore or modify worker directories

**ALWAYS:**
- Spawn a worker agent for every piece of work
- Brief workers with structured `brief` parameter or `BRIEF.md`
- Monitor via `agent_status`, `agent_peek`
- Synthesise results and report to the human

### 2.2 Worker / Teammate

Workers receive a structured brief and execute autonomously within scope.

**Protocol:**
1. Read your brief (rendered in initial prompt or as `BRIEF.md`)
2. Work autonomously within declared scope
3. Signal milestones: `agent_send to orchestrator: "NOTE T-NNN — description"`
4. Signal completion: `agent_send to orchestrator: "DONE T-NNN — summary"`
5. Signal blocked: `agent_send to orchestrator: "BLOCKED T-NNN — what you need"`

---

## 3. Task Classification & Topology Selection

Every task has two dimensions: **domain complexity** (Cynefin [R-CYN]) and **coordination structure** (Kim et al. [R-KIM]).

### 3.1 Classify the Domain

| Domain | Signal | Decision Pattern |
|--------|--------|------------------|
| **Clear** | Exact spec, known solution | Sense → Categorise → Respond |
| **Complicated** | Goal clear, approach needs analysis | Sense → Analyse → Respond |
| **Complex** | Goal clear, approach unknown, needs probes | Probe → Sense → Respond |
| **Chaotic** | Nothing works, stabilise first | Act → Sense → Respond |

> **Research:** Cynefin framework — Snowden & Boone (2007), *A Leader's Framework for Decision Making*, HBR. See `~/git/working-notes/research/cynefin-scatter-focus/`. [R-CYN]

### 3.2 Choose Topology

| Domain | Topology | Why |
|--------|----------|-----|
| **Clear** | Single agent (Haiku) | MAS degrades 39–70% on sequential tasks [R-KIM] |
| **Complicated** | Single agent (Sonnet) | Full token budget outperforms split teams [R-KIM] |
| **Complex** | Orchestrator + workers (centralised MAS) | +40–80% on parallelisable tasks [R-KIM] |
| **Chaotic** | Opus single agent or human-in-the-loop | Strongest reasoner to stabilise [R-KIM] |

> **Research:** Kim et al. (2025), *Towards a Science of Scaling Agent Systems*, arXiv:2512.08296. 180-configuration controlled study. See `~/git/working-notes/research/multi-agent-coordination/`. [R-KIM]

### 3.3 Key Rules

- **Sequential → single agent, always.** Splitting sequential work degrades 39–70%. [R-KIM]
- **Parallel → centralised MAS.** Independent workers + orchestrator synthesis gives +40–80%. Never independent MAS (17× error amplification). [R-KIM]
- **Tool-heavy → single agent.** Token budget fragmentation reduces reasoning (β=−0.267). [R-KIM]
- **Capability saturation:** If one agent scores >45%, more agents yield negative returns (β=−0.404). [R-KIM]
- **Coordination cost is the real expense.** A team only beats a solo agent when internal coordination is cheaper than transaction costs. [R-COASE, R-WILL]
- **Model diversity for review.** Correlated errors from the same model family provide no ensemble benefit (Condorcet jury theorem). [R-SWARM]
- **Start cheap, escalate when needed.** Haiku/Sonnet finish simple work in seconds; Opus gets stuck on simple edits.

---

## 4. Briefing Protocol

The brief is the mission spec. Brief quality determines worker speed.

### 4.1 Structured Brief (preferred)

```javascript
spawn_agent({
  name: "worker-name",
  cwd: "./workers/subtask-name",
  brief: {
    classification: "sequential",  // auto-routes model
    goal: "Clear, single-paragraph objective",
    successCriteria: [
      "Testable condition 1",
      "Testable condition 2"
    ],
    scope: {
      include: ["/absolute/path/to/file.ts"],
      exclude: ["what NOT to touch"]
    },
    context: "Detailed instructions, code snippets, constraints..."
  }
})
```

### 4.2 Brief Field Reference

| Field | Purpose | Maps to |
|-------|---------|---------|
| `goal` | Single-paragraph objective | What to build |
| `successCriteria` | Testable, observable conditions (array) | Definition of done |
| `scope.include` | Absolute paths to files the worker reads/edits | Boundaries |
| `scope.exclude` | What NOT to touch | Guardrails |
| `context` | Free-form prose: exact changes, code snippets, constraints | Implementation detail |
| `classification` | `sequential \| parallelisable \| high-entropy-search \| tool-heavy` | Model auto-routing |

### 4.3 When to Use BRIEF.md Instead

Use a file on disk only when:
- Brief exceeds ~2KB
- Multiple agents reference the same spec
- Brief contains diagrams, tables, or complex formatting

Then: `task: "Read BRIEF.md and complete the mission."`

> **Research:** Problem crystallisation — coaching methodologies for transforming fuzzy → actionable problems. See `~/git/working-notes/research/problem-crystallisation/`. [R-PROB]

---

## 5. Model Selection Guide

### 5.1 Provider Tiers (Cost)

| Tier | Provider | Cost | When |
|------|----------|------|------|
| 🆓 **Free** | Ollama (local) | Free | Conversational, planning, simple edits |
| 🆓 **Subscription** | Anthropic (direct) | Flat-rate | Coding, implementation, orchestration |
| 🆓 **Subscription** | Google Gemini CLI | Flat-rate | Research, large context (1M tokens) |
| 💰 **Pay-per-token** | OpenRouter (GPT, DeepSeek) | Per-token | Only when subscription models can't do the job |

**Never use OpenRouter as a proxy** for models with subscription access.

### 5.2 Role-Based Model Preferences

| Role | Preference Order | Why |
|------|-----------------|-----|
| **Coding worker** (exact spec) | Ollama → Haiku | Free; Haiku if Ollama struggles |
| **Coding worker** (multi-file) | Haiku → Sonnet | Standard implementation |
| **Orchestrator** | Opus → Gemini Pro → GPT 5.x | Strongest reasoning for decomposition |
| **Research scout** (broad) | Gemini Flash | 1M context, fast, subscription |
| **Research analyst** (deep) | Gemini Pro → Opus | 1M context for deep synthesis |
| **Reviewer / auditor** | GPT 5.x → Opus | Different model family catches different bugs [R-SWARM] |
| **Quick task / test** | Ollama → Haiku | Cheapest that works |
| **Debug / chaotic** | Opus | Strongest single-agent reasoner |

### 5.3 Staffing Table

**Solo tasks (Clear/Complicated):**

| Complexity | Model | Examples |
|-----------|-------|----------|
| Clear — exact spec, single file | **Haiku** | Targeted edit, config change |
| Complicated — multi-file | **Sonnet** | Refactor, feature build |
| Tool-heavy — long tool chains | **Sonnet** (never split) | Many bash/read/edit cycles |
| Chaotic — ambiguous | **Opus** | Root cause analysis |

**Team tasks (Complex):**

| Role | Model | Job |
|------|-------|-----|
| Orchestrator | Opus → Gemini Pro → GPT 5.x | Decompose, brief, monitor, synthesise |
| Workers | Haiku or Sonnet per sub-task | Execute individual deliverables |
| Research scouts (broad) | Gemini Flash (1M) | Codebase scans, literature sweeps |
| Research scouts (deep) | Gemini Pro (1M) | Cross-domain synthesis |

### 5.4 Rules

- **Subscriptions first, always.** Anthropic and Gemini CLI are flat-rate.
- **Check availability** with `pi --list-models` before spawning.
- **Start cheap, escalate when needed.**
- **Use model diversity for review** — different families catch different bugs. [R-SWARM]
- **Default to brief-based auto-routing.** Only override `model` when there's a specific reason.

> **Research:** Condorcet jury theorem — ensemble benefit requires uncorrelated errors. Same model family = correlated errors = no diversity gain. See `~/git/working-notes/research/swarm-intelligence/`. [R-SWARM]
>
> **Research:** Coase (1937) transaction cost economics — AI has near-zero search/bargaining costs but high monitoring costs. See `~/git/working-notes/research/coase-ai-orgs/`. [R-COASE]

---

## 6. Monitoring Protocol

### 6.1 Orchestrator Monitoring Loop

1. **Check agent health** before messaging: `agent_status(name)`
   - If actively streaming → **wait**
   - Never pile multiple messages on a working agent (causes context fragmentation)
2. **Observe activity**: `agent_peek(name)` to read worker progress
3. **Nudge stalled agents**: `agent_nudge(name, message)` when `agent_status` reports stalled/blocked
4. **One message at a time** — wait for agent to finish current turn before sending follow-up

### 6.2 Health Status Taxonomy

| Status | Meaning | Action |
|--------|---------|--------|
| `active` | Working normally | Wait |
| `stalled` | PID alive but stuck | Nudge |
| `sleeping` | PID alive, fresh heartbeat, no activity | Likely system sleep; wait |
| `terminated` | PID dead | Expire claim, respawn if needed |
| `api_error` | Recent API errors | Check logs |
| `blocked` | Self-reported blocked | Unblock or reassign |
| `waiting` | Idle, awaiting work | Send task |

> **Research:** 12-status taxonomy from Overcode. See `~/git/working-notes/research/overcode-agent-tracking/`. [R-OVER]
>
> **Research:** Sleep-aware stall detection — check PID liveness separately from heartbeat staleness. See `~/git/working-notes/research/kanban-research/`, `~/git/working-notes/research/t-074-ipc-debug/`. [R-KAN, R-IPC]

---

## 7. Inter-Agent Communication

### 7.1 Messaging Protocol

Agents communicate via `agent_send` (panopticon IPC). The orchestrator is the single writer for any shared state (kanban board, STATE.md).

**Workers report status via `agent_send`:**
```
agent_send to orchestrator: "NOTE T-NNN — milestone description"
agent_send to orchestrator: "DONE T-NNN — summary"
agent_send to orchestrator: "BLOCKED T-NNN — what you need"
```

### 7.2 Cross-Repo Messaging

Before sending to an agent in another repo:

1. **Discover** — `agent_peek` to read target's context
2. **Context-pack** — Message must be self-contained:
   - What you need (the ask)
   - Why (background)
   - Absolute file paths (they're in a different repo)
   - Constraints or format requirements
3. **Never assume shared context** — the other agent hasn't read your brief

> **Research:** Stigmergic (indirect) communication via shared state reduces coordination overhead to O(1) per agent. See `~/git/working-notes/research/digital-pheromones/`. [R-PHER]
>
> **Research:** Maildir inbox — atomic tmp→new→cur delivery survives crashes and Mac sleep. See `~/git/working-notes/research/t-075-durable-messaging/`. [R-DUR]

---

## 8. Error Recovery

Agents rarely self-recover from errors. The top error types are all recoverable:

| Error Type | Frequency | Recovery Strategy |
|-----------|-----------|-------------------|
| `edit` text-not-found | 45/500+ | Re-read file before editing |
| `bash` exit-code-1 | 148/500+ | Read stderr, adjust command |
| FS not-found | 63/500+ | Check path, create parent dirs |
| JSON parse error | Common | Sanitise output before parsing |

**Principle:** Read stderr as data. Pivot, don't retry the same command.

> **Research:** Error catalogue — 500+ errors across 194 sessions. See `~/git/working-notes/research/error-research/`. [R-ERR]

---

## 9. Research Projects

All research lives in `~/git/working-notes/research/`. Never run research in the orchestrator's repo.

**Workflow:**
1. Create directory: `~/git/working-notes/research/{topic}/`
2. Set agent cwd to that directory
3. Conduct research, document in `REPORT.md`

**Use the `research-expert` skill** for automated literature reviews (Semantic Scholar + Jina Reader).

> **Research:** Native tool integration always beats wrapping autonomous agents. See `~/git/working-notes/research/research-expert-skill/`. [R-RES]

---

## 10. Research Appendix — Citation Key

Every `[R-XXX]` tag in this document maps to a specific research report:

| Key | Report Directory | Citation |
|-----|-----------------|----------|
| [R-KIM] | `multi-agent-coordination` | Kim et al. (2025), *Towards a Science of Scaling Agent Systems*, arXiv:2512.08296. T-056/T-166. |
| [R-COASE] | `coase-ai-orgs` | Coase (1937), *The Nature of the Firm*; Williamson (1985), *Economic Institutions of Capitalism*. T-166. |
| [R-WILL] | `coase-ai-orgs` | Williamson (1985) — high asset specificity + uncertainty → hierarchy; low → market. T-166. |
| [R-CYN] | `cynefin-scatter-focus` | Snowden & Boone (2007), *A Leader's Framework for Decision Making*, HBR. |
| [R-SWARM] | `swarm-intelligence` | Condorcet (1785); Wang et al. MoA (65.1% AlpacaEval). |
| [R-PHER] | `digital-pheromones` | Stigmergic communication, ant colony optimisation. T-167. |
| [R-DUR] | `t-075-durable-messaging` | Maildir inbox: atomic delivery, crash-safe. T-075. |
| [R-KAN] | `kanban-research` | Sleep-aware stalls, status taxonomy, task classification. |
| [R-IPC] | `t-074-ipc-debug` | Socket staleness fixes: bind-before-advertise, Mac sleep rebind. T-074. |
| [R-ERR] | `error-research` | 500+ errors across 194 sessions; agents rarely self-recover. T-148. |
| [R-OVER] | `overcode-agent-tracking` | 12-status taxonomy, dual-strategy detection (hooks + polling). |
| [R-MEM] | `machine-memory` | YAML cheat sheets, 60–80% token reduction, four-layer memory hierarchy. T-171. |
| [R-CLI] | `agent-first-cli` | JSON default output, field projection, machine memory files. T-171. |
| [R-PROB] | `problem-crystallisation` | Coaching methodologies: fuzzy → actionable problem statements. |
| [R-RES] | `research-expert-skill` | Native Semantic Scholar + Jina; no wrapping autonomous agents. T-067. |
| [R-LOOP] | `strange-loops` | Self-referential loops: Constitutional AI, Reflexion, SRPO 48.9→99.2%. |
| [R-1000] | `thousand-brains` | Hawkins' cortical column voting — parallel models → consensus. |
| [R-FEP] | `active-inference` | Free Energy Principle — agents minimise surprise via perception + action. |
| [R-SQT] | `square-vs-tower` | Networks for exploration, hierarchies for execution. |

All reports live at `~/git/working-notes/research/{directory}/REPORT.md`.

---

## Quick Reference

```bash
# Spawn a worker with auto-routed model
spawn_agent name="worker" cwd="./task-dir" brief={...}

# Check health before messaging
agent_status name="worker"

# Observe activity
agent_peek target="worker"

# Nudge stalled agent
agent_nudge name="worker" message="Status check — are you blocked?"

# List available models
pi --list-models
```

**Remember: Orchestrators spawn, workers do. Never invert this.**
