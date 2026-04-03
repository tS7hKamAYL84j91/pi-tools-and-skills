# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Documentation Review** — Comprehensive analysis of 1,800+ lines across 15 files
  - Identified 8 critical gaps (README, quick-start, testing guide, architecture overview, etc.)
  - 3-phase remediation plan (16 hours to full coverage)
  - [DOCUMENTATION_REVIEW.md](DOCUMENTATION_REVIEW.md)

### In Progress
- Phase 2: Integration tests for agent lifecycle
- Phase 2: New documentation (guides, testing, troubleshooting)

---

## [Phase 1 Complete] — 2026-04-03

### Added
- **Extension Merge** — Consolidated 3 extensions into unified `pi-agents/` module
  - Single entry point (`index.ts`) with 7 focused modules
  - Registry, Socket, Messaging, Spawner, Peek, UI, Types
  - Eliminated operational coupling (concurrent writes, load-order races)
  - [PLAN.md](planning/PLAN.md) Phase 1-9 complete

- **Google TypeScript Style Guide Integration**
  - 50 rules added to [AGENT.md](AGENT.md)
  - Naming, types, control flow, functions, modules, comments, disallowed features
  - Links to official style guide for reference

- **Code Quality Audit**
  - [CODE_REVIEW.md](CODE_REVIEW.md) — Comprehensive review
  - 98.88% type coverage (8,165/8,257 symbols)
  - 90/91 tests passing (98.9% pass rate)
  - Identified 3 fixable lint warnings, 1 test mock issue

- **Improvement Roadmap**
  - [IMPROVEMENTS.md](IMPROVEMENTS.md) — 6-phase plan over 4 weeks
  - Phase 1: Code fixes (1 day)
  - Phase 2: Integration tests + docs (week 1)
  - Phase 3: Legacy file cleanup, registry optimization (weeks 2-3)
  - Phase 4: New features (aliases, health monitoring)
  - Phase 5: Stress tests, polish (weeks 4-5)
  - Phase 6: Performance tuning (weeks 5-6)

### Fixed
- **Lint Issues (3 warnings → 0)**
  - Removed unnecessary constructor in Socket server
  - Replaced non-null assertion with optional chaining in Registry
  - Fixed export type syntax in types.ts

- **Test Suite**
  - 1 failing test (agent_broadcast mock setup) → fixed via proper mock recreation
  - All 102 tests now passing
  - Added lifecycle integration tests

### Changed
- Registry now single owner of AgentRecord (no concurrent writes)
- Session info (sessionDir, sessionFile) stored in AgentRecord
- Subagents always get session directories (no more `--no-session`)
- pendingMessages count ownership moved to messaging extension

### Removed
- ~~Panopticon custom activity maildir~~ (now uses pi session JSONL)
- ~~agent_send_durable tool~~ (implementation detail, use durable transport instead)
- ~~Load-order race condition~~ (explicit lifecycle ordering in index.ts)

---

## [Pre-Phase 1 Work] — 2026-03-29 to 2026-04-02

### Analysis & Planning
- Initial architecture review of 3 extensions (612 + 252 + 555 LOC)
- Identified operational coupling patterns (concurrent writes, PID scans, implicit cleanup)
- Mapped data ownership (registry, messages, sessions, sockets)
- Created 9-phase remediation plan

### Knowledge Base
- [KNOWLEDGE.md](planning/KNOWLEDGE.md) — Architecture snapshot
- [PARALLEL-SPEC.md](planning/PARALLEL-SPEC.md) — Load-order race analysis
- [REFACTOR.md](planning/REFACTOR.md) — Decoupling strategy notes

### Infrastructure
- 4 test files with 91 tests (panopticon, messaging, subagent, maildir)
- 5 shared library modules (agent-registry, message-transport, session-log, tool-result, maildir)
- Biome linter + TypeScript strict mode + 95% type coverage requirement

---

## [Earlier] — 2026-03-01 to 2026-03-28

### Skills Landscape
- Researched K-Dense Scientific Skills (180+ skills)
- Evaluated Trail of Bits security skills
- Catalogued available Anthropic skills
- [skills-landscape.md](docs/skills-landscape.md)

### Documentation Foundation
- [ARCHITECTURE-REVIEW.md](docs/ARCHITECTURE-REVIEW.md) — Pre-refactor audit
- [PI-MESSAGING-ARCHITECTURE.md](docs/PI-MESSAGING-ARCHITECTURE.md) — Design principles
- [PI-MESSAGING-GUIDE.md](docs/PI-MESSAGING-GUIDE.md) — User guide
- [MAILDIR-TRANSPORT.md](docs/MAILDIR-TRANSPORT.md) — Protocol deep-dive
- [pi-tui-capabilities.md](docs/pi-tui-capabilities.md) — UI reference

### Setup
- Initial repository structure
- Skills: planning, research-expert, red-team, skill-creator
- Extension architecture: panopticon, messaging, subagent
- Test infrastructure: Vitest, type-coverage

---

## Legend

- ✅ Completed
- 🚀 In Progress
- 🔄 Planned
- ⚠️ Needs Attention
- ❌ Blocked

---

## Next Milestones

| Phase | Status | Target Date |
|-------|--------|-------------|
| **1: Code Fixes** | ✅ Complete | 2026-04-03 |
| **2: Docs + Tests** | 🚀 In Progress | 2026-04-10 |
| **3: Optimization** | 🔄 Planned | 2026-04-17 |
| **4: Features** | 🔄 Planned | 2026-04-24 |
| **5: Stress Test** | 🔄 Planned | 2026-05-01 |
| **6: Performance** | 🔄 Planned | 2026-05-08 |

---

## Version History

| Version | Date | Phase | Status |
|---------|------|-------|--------|
| unreleased | — | 2 (in progress) | 🚀 |
| 0.9.0 | 2026-04-03 | 1 complete | ✅ |
| 0.1.0 | 2026-03-01 | foundation | ✅ |

---

## Contributing

When adding features or fixes:
1. Update this file in the `[Unreleased]` section
2. Use categories: Added, Fixed, Changed, Removed, Deprecated
3. Follow conventional commits: `feat(scope): message`
4. Reference files/commits where relevant

See [IMPROVEMENTS.md](IMPROVEMENTS.md) for the development roadmap.
