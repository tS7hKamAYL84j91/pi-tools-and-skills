# Documentation Review — tools-and-skills

**Date:** 2026-04-03  
**Status:** Substantial but fragmented; 1,802 lines across multiple docs

---

## Executive Summary

The repository has **excellent technical documentation** but suffers from:
1. **No unified entry point** — Reader doesn't know where to start
2. **Planning docs outdated** — Left behind after Phase 3 completed
3. **Missing quick-start** — README is bare (1 line)
4. **Architecture docs scattered** — Multiple docs with overlapping topics
5. **No user-facing guide** — Skills, tools, and extensions not indexed
6. **Test documentation missing** — How to run tests, structure unclear

**Overall:** **B+ (Good depth, poor organization)**

---

## 📊 Documentation Inventory

### By Location & Size

```
docs/
├── ARCHITECTURE-REVIEW.md      303 lines  ✅ Thorough post-refactor audit
├── MAILDIR-TRANSPORT.md        349 lines  ✅ Excellent technical depth
├── PI-MESSAGING-ARCHITECTURE.md 227 lines ✅ Clear design decisions
├── PI-MESSAGING-GUIDE.md       327 lines  ✅ Good user guide (partial)
├── pi-tui-capabilities.md      112 lines  ⚠️  Sparse, outdated reference
└── skills-landscape.md         110 lines  ⚠️  Research notes, not docs

planning/
├── KNOWLEDGE.md                 62 lines  ⚠️  Current knowledge base snapshot
├── PLAN.md                     153 lines  ✅ Current phase (Phase 9 items)
├── PROGRESS.md                  52 lines  ⚠️  Last update April 3
├── PARALLEL-SPEC.md             62 lines  ⚠️  Old analysis (from Phase 2)
└── REFACTOR.md                  44 lines  ⚠️  Stale notes

Root
├── README.md                     1 line   ❌ Bare project name
├── AGENT.md                     71 lines  ✅ Agent directive (NEW)
├── CODE_REVIEW.md              188 lines  ✅ Code quality audit (NEW)
└── IMPROVEMENTS.md             305 lines  ✅ 6-phase improvement plan (NEW)

lib/
└── transports/README.md         17 lines  ✅ Interface + quick add guide
```

**Total: 1,802 lines** across 15 markdown files

---

## 🟢 Strengths

### 1. Technical Documentation (⭐⭐⭐⭐⭐)

**MAILDIR-TRANSPORT.md** (349 lines)
- Excellent visual diagrams (directory structure, message flow)
- Clear before/after sections
- Atomic operations explained
- Failure mode discussion

**PI-MESSAGING-ARCHITECTURE.md** (227 lines)
- Principle-first explanation
- Interface clearly defined
- Wiring examples (extensibility)
- Class diagram shows composability

**ARCHITECTURE-REVIEW.md** (303 lines)
- Dependency graphs with mermaid
- Ownership matrix
- Bleeds resolved + remaining
- Pre/post refactor comparison

### 2. Code-Level Documentation (⭐⭐⭐⭐)

- JSDoc on public APIs
- Pure functions extracted for tests (exported, documented)
- Example: `classifyRecord`, `buildRecord`, `pickName` — all explained
- Comments on non-obvious code (e.g., atomic Maildir writes)

### 3. Recent Additions (⭐⭐⭐⭐)

- **AGENT.md** — Google TS style guide rules, clear and actionable
- **CODE_REVIEW.md** — Detailed audit with metrics, fix priorities
- **IMPROVEMENTS.md** — 6-phase roadmap with timeline and success criteria

---

## 🔴 Critical Gaps

### 1. No README / Quick Start (❌)

```markdown
# tools-and-skills
```

That's it. Reader lands here and doesn't know:
- What this repo is
- How to use it
- Where to start reading

**Fix:** Replace with:
```markdown
# tools-and-skills

A unified Pi agent infrastructure and skill management system.

## Quick Links

- **Getting Started** → [README-GETTING-STARTED.md](#)
- **Agent System** → [docs/ARCHITECTURE.md](#) | [Guide](#)
- **Messaging** → [PI-MESSAGING-GUIDE.md](docs/PI-MESSAGING-GUIDE.md)
- **Transports** → [lib/transports/README.md](lib/transports/README.md)
- **Skills** → [skills/](#)
- **Development** → [CODE_REVIEW.md](CODE_REVIEW.md) | [IMPROVEMENTS.md](IMPROVEMENTS.md)

## What's Here

```

---

### 2. Planning Docs Are Stale

**PLAN.md** (153 lines)
- Phase 9 is "Delete old files and verify" ✓ Done (per agent activity)
- No section marking completion
- Implies work still in progress

**Fix:** Update header:
```markdown
# Plan: Merge Three Extensions into One — ✅ COMPLETE (2026-04-03)

## Completed Phases (1-9)
[summary]

## Next: See IMPROVEMENTS.md for Phase 2+ roadmap
```

**PARALLEL-SPEC.md** (62 lines)
- Notes from old refactor phase
- No longer relevant
- Should be archived

---

### 3. User/Task Guides Missing

No docs for:
- "How do I spawn an agent?"
- "How do I send a message between agents?"
- "How do I use a skill?"
- "How do I extend messaging with a custom transport?"

**Fix:** Create `docs/GUIDES/` directory:
```
docs/GUIDES/
├── QUICK-START.md           (5 min read)
├── SPAWNING-AGENTS.md       (10 min)
├── MESSAGING.md             (15 min, with examples)
├── CUSTOM-TRANSPORT.md      (20 min, code walkthrough)
└── USING-SKILLS.md          (10 min)
```

---

### 4. Testing Documentation Missing

No guide for:
- Running tests: `npm test` — what does it cover?
- Test structure: unit vs integration vs pure functions
- Mocking: how to mock Registry, Transport, ExtensionAPI
- Adding tests: template for new test files

**Fix:** Create `docs/TESTING.md`:
```markdown
# Testing Guide

## Quick Start
npm test           # Run all tests
npm test -- <file> # Run one file
npm run type-coverage --details

## Test Structure

### Pure Function Tests (panopticon-pure.test.ts)
- No mocks, no side effects
- Test: classifyRecord, pickName, formatAge, etc.
- Run in <10ms

### Module Tests (pi-messaging.test.ts, pi-agents-lifecycle.test.ts)
- Mock: ExtensionAPI, Registry, MessageTransport
- Test: Tool registration, execute, side effects
- Run in <100ms

### Integration Tests (TODO)
- Test: Full lifecycle (session_start → shutdown)
- Test: Multiple agents, message flow
- Run in <1s

## Mocking Patterns

[Examples of mock setup for each component]
```

---

### 5. No Architecture Diagram for Users

ARCHITECTURE-REVIEW.md has mermaid graphs but is 300+ lines.

**Fix:** Create minimal `docs/ARCHITECTURE.md` (instead of REVIEW):
```markdown
# Architecture

## Modules

```
extensions/pi-agents/
├── index.ts        Entry point, lifecycle
├── registry.ts     Agent CRUD, heartbeat
├── messaging.ts    agent_send, agent_broadcast
├── spawner.ts      spawn_agent, rpc_send
├── peek.ts         agent_peek tool
├── socket.ts       Unix socket server
├── ui.ts           Widget, /agents overlay
└── types.ts        Shared interfaces
```

lib/
├── agent-registry.ts        AgentRecord, CRUD, cleanup
├── message-transport.ts     MessageTransport interface
├── session-log.ts           Session JSONL reader
├── tool-result.ts           ok()/fail()
└── transports/
    └── maildir.ts           File-based queue
```

[4-line data flow diagram here]
```

## Data Flow

Agent A sends message to Agent B:

```
A: agent_send "B" "hello"
    → messaging.ts
    → MessageTransport.send(B, "A", "hello")
    → MaildirTransport writes to ~/.pi/agents/B-id/inbox/new/
    
B: session_start
    → messaging.init()
    → drainInbox() reads B's inbox
    → transport.receive(B-id) → [messages from A]
    → pi.sendUserMessage("Message from A: hello")
    → transport.ack(message-id)
```
```

---

### 6. Skills Documentation

`skills-landscape.md` is research notes, not user documentation.

**Gap:** No index of available skills with examples.

**Fix:** Create `docs/SKILLS.md`:
```markdown
# Skills

Specialized agents for specific domains.

## Available Skills

### planning
Persistent markdown-based planning with PLAN.md, PROGRESS.md, KNOWLEDGE.md.
Example: `spawn_agent name: "planner" sessionDir: "/path/..."`

### research-expert
Academic and technical research via Semantic Scholar, Tavily, GitHub.
Example: `agent_send "research" "Find papers on X"`

### red-team
Security assessment and vulnerability identification.
Example: `agent_send "redteam" "Audit this code"`

### skill-creator
Create or improve skills. Uses Agent Skills specification.
Example: [See skill-creator/SKILL.md](../skills/skill-creator/SKILL.md)

### get-weather
Current weather for any city.
Example: [See get-weather/SKILL.md](../skills/get-weather/SKILL.md)
```

---

## 🟡 Medium Issues

### 1. TUI Capabilities Doc Is Sparse
**pi-tui-capabilities.md** (112 lines) has bullet points but no:
- Command syntax reference
- Key bindings table
- Example workflows

**Fix:** Expand or link to pi documentation

---

### 2. Messaging Guide Is Incomplete
**PI-MESSAGING-GUIDE.md** stops at 227 lines (offset=81).

Should cover:
- Error handling examples
- Testing your messaging code
- Troubleshooting (message loss, stalls)
- Advanced: adding a custom transport

---

### 3. No CHANGELOG / Release Notes
When features are added, no central place to document them.

**Fix:** Add `CHANGELOG.md`:
```markdown
# Changelog

## [Unreleased]

### Added
- Extension merge: pi-agents unified entry point
- Google TS style guide rules in AGENT.md
- Code review and improvements roadmap

### Fixed
- 3 lint warnings (constructor, non-null assert, export type)
- agent_broadcast test mock setup

## [Phase 2 Complete] 2026-04-03
...
```

---

### 4. No Troubleshooting Guide
No doc for "When things go wrong":
- Registry corrupt (can't parse {id}.json)
- Socket server fails to bind
- Messages stuck in inbox
- Agent heartbeat stalled

**Fix:** Create `docs/TROUBLESHOOTING.md`

---

## 📋 Documentation Checklist

| Category | Item | Status | Priority |
|----------|------|--------|----------|
| **Entry** | README with quick links | ❌ | 🔴 P0 |
| | Quick start (5 min) | ❌ | 🔴 P0 |
| **Architecture** | Unified diagram + data flow | ⚠️ | 🔴 P1 |
| | Module responsibilities | ✅ | — |
| | Design decisions rationale | ✅ | — |
| **User Guides** | Spawning agents | ❌ | 🟡 P2 |
| | Sending messages | ⚠️ | 🟡 P2 |
| | Using skills | ❌ | 🟡 P2 |
| | Custom transport creation | ✅ | 🟢 P3 |
| **Technical** | Maildir protocol | ✅ | — |
| | Message transport interface | ✅ | — |
| | Session log format | ⚠️ | 🟢 P3 |
| **Testing** | How to run tests | ❌ | 🟡 P2 |
| | Test structure & patterns | ❌ | 🟡 P2 |
| | Mocking guide | ⚠️ | 🟡 P2 |
| **Ops** | Troubleshooting | ❌ | 🟡 P2 |
| | Monitoring agents | ❌ | 🟡 P2 |
| | Cleanup / maintenance | ❌ | 🟡 P2 |
| **Development** | Code review summary | ✅ | — |
| | Improvement roadmap | ✅ | — |
| | Style guide (TS) | ✅ | — |
| | Changelog | ❌ | 🟡 P2 |

---

## 🛠️ Recommended Actions

### Immediate (Day 1)

1. **Update README.md** with quick links
2. **Archive stale planning docs** (PARALLEL-SPEC.md, REFACTOR.md)
3. **Mark PLAN.md as complete**
4. **Create CHANGELOG.md** (backfill with phase completion dates)

### Week 1

5. **Create docs/ARCHITECTURE.md** (minimal, user-focused)
6. **Create docs/TESTING.md** with examples
7. **Create docs/GUIDES/** directory with 3-5 short guides

### Week 2

8. **Create docs/TROUBLESHOOTING.md**
9. **Create docs/SKILLS.md** with index
10. **Expand PI-MESSAGING-GUIDE.md** (finish from offset=81)

### Ongoing

11. **Update docs on every feature addition** (include in PR checklist)
12. **Link from code comments to relevant docs**
13. **Add example walkthroughs in guides/examples/**

---

## 📚 New File Structure (Recommended)

```
/
├── README.md                          ← Entry point, quick links
├── CHANGELOG.md                       ← Release notes (NEW)
├── AGENT.md                           ← Development directives ✅
├── CODE_REVIEW.md                     ← Audit & metrics ✅
├── IMPROVEMENTS.md                    ← Roadmap ✅

docs/
├── ARCHITECTURE.md                    ← Unified overview (NEW/simplified)
├── TESTING.md                         ← How to test (NEW)
├── TROUBLESHOOTING.md                 ← Debugging guide (NEW)
├── SKILLS.md                          ← Skill index (NEW)
├── ADVANCED/
│   ├── MAILDIR-PROTOCOL.md           ← Move current MAILDIR-TRANSPORT.md
│   ├── MESSAGE-TRANSPORT-DESIGN.md   ← Move PI-MESSAGING-ARCHITECTURE.md
│   ├── DEPENDENCY-ANALYSIS.md        ← Rename ARCHITECTURE-REVIEW.md
│   └── REGISTRY-INTERNALS.md         ← NEW: Deep dive on Registry class
├── GUIDES/
│   ├── QUICK-START.md                ← (NEW) 5 min to first message
│   ├── SPAWNING-AGENTS.md            ← (NEW) spawn_agent examples
│   ├── MESSAGING.md                  ← Rename/expand PI-MESSAGING-GUIDE.md
│   ├── CUSTOM-TRANSPORT.md           ← (NEW) Add Socket/Redis transport
│   └── USING-SKILLS.md               ← (NEW) Skills quick-start
├── pi-tui-capabilities.md            ← Keep (reference Pi project)
└── skills-landscape.md               ← Archive or integrate into SKILLS.md

planning/                              ← Keep for historical record
├── PLAN.md                           ← Mark COMPLETE
├── PROGRESS.md                       ← Final status
└── KNOWLEDGE.md                      ← Keep as reference

lib/transports/
└── README.md                         ✅ Keep (good as-is)
```

---

## 📝 Sample: New README.md

```markdown
# tools-and-skills

A unified Pi agent infrastructure with extensible messaging, skill management, 
and multi-agent orchestration.

## 🚀 Quick Start

**First time here?** Read [docs/GUIDES/QUICK-START.md](docs/GUIDES/QUICK-START.md) 
(5 minutes to your first agent message).

## 📖 Documentation

### For Users
- **[Agent System](docs/GUIDES/QUICK-START.md)** — Spawn agents, send messages
- **[Messaging Guide](docs/GUIDES/MESSAGING.md)** — Detailed usage + examples
- **[Available Skills](docs/SKILLS.md)** — What agents can do
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — Fix common issues

### For Developers
- **[Architecture](docs/ARCHITECTURE.md)** — Module structure + data flow
- **[Testing Guide](docs/TESTING.md)** — Running tests, mocking patterns
- **[Code Review](CODE_REVIEW.md)** — Type safety, metrics, quality gates
- **[Improvement Plan](IMPROVEMENTS.md)** — 6-phase roadmap
- **[Development Rules](AGENT.md)** — TypeScript style, quality gates

### For Architects
- **[Design Deep-Dives](docs/ADVANCED/)** — Maildir, Message Transport, Dependency Analysis
- **[Changelog](CHANGELOG.md)** — Feature releases and history

## 🏗️ Project Structure

```
extensions/pi-agents/     ← Unified agent infrastructure
lib/                      ← Shared interfaces and transports
skills/                   ← Specialized agents (planning, research, security)
docs/                     ← User and developer guides
tests/                    ← Test suite (91 tests)
```

## ✨ Key Features

- **Multi-Agent Communication** — agent_send, agent_broadcast
- **Durable Messaging** — At-least-once delivery via Maildir
- **Extensible Transports** — Swap Maildir for Socket, Redis, etc.
- **Skill Management** — Specialized agents for domain-specific tasks
- **Type Safe** — 98.88% type coverage, strict TypeScript

## 🔗 Links

- [Pi Coding Agent](https://github.com/mariozechner/pi) (base framework)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)

## 📊 Project Stats

- **1,420 LOC** extensions
- **460 LOC** library layer
- **1,060 LOC** tests (91 passing)
- **98.88%** type coverage

## 📝 License

[Your License Here]
```

---

## Conclusion

The repository has **strong technical documentation** but lacks **user-facing organization**. 

**Priority fixes:**
1. **README** → Entry point with navigation
2. **Quick-start guide** → First message in <5 min
3. **Test documentation** → How to run, structure, patterns
4. **Architecture summary** → Not 300+ lines, just the essentials
5. **Archival** → Mark old planning docs as historical

**Estimated effort:** 
- Immediate (day 1): 3 hours
- Week 1: 8 hours (new guides, testing docs)
- Week 2: 5 hours (advanced docs, polish)
- **Total: ~16 hours** to comprehensive documentation

**Expected outcome:** 
A visitor can understand the project, run tests, and start using it within 15 minutes.

