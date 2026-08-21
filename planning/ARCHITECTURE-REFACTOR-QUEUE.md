# Architecture Refactoring Queue & Execution Plan

**Status:** Completed — follow-up interactive-shell coverage remains separately tracked.
**Document:** `planning/ARCHITECTURE-REFACTOR-QUEUE.md`  
**Scope:** Monorepo-wide architectural improvements.  
**Boundary Isolation:** `extensions/pi-boost/*`, `team-paths.ts`, and neutral config discovery in `lib/` remain strictly **OUT OF SCOPE** (owned by peer on T-851).

---

## Executive Overview

This plan organizes architectural improvements into sequential tracks with explicit acceptance criteria, quality gates, property-based invariants, and validation commands.

```mermaid
flowchart TD
  subgraph Completed["Completed Slices (refactor/pi-teams-decoupling)"]
    C1["Track 3.1: Pluggable Teams Topology SPI in lib/team-protocol-spi.ts"]
    C2["Track 6: Fast-Check Property Invariants (Kanban, Goal)"]
    C3["Track 7: Automated AGENTS.md Directives (Dependencies, TS Style, Ratchet, Prompt Hygiene)"]
  end

  subgraph CompletedTrack1["Merged Track 1 Slices"]
    T1A["Track 1.1: pi-goal entrypoint\n• 483 -> 99 LOC\n• main @ 8405804"]
    T1B["Track 1.2: teams/state.ts\n• 543 -> 250 LOC\n• main @ 8e59075"]
  end

  subgraph CompletedDelivery["Completed Delivery Slices"]
    T2["Track 2: deterministic TUI view-model, snapshot, and command tests"]
    T4["Track 4: single-tenant helpers and CLI entrypoints relocated; layering enforced"]
    T5["Track 5: EventLog adopted by Kanban; Teams remains session-entry backed"]
  end

  subgraph OutOfScope["Out of Scope (Peer Authority T-851)"]
    OOS1["extensions/pi-boost/**"]
    OOS2["team-paths.ts & neutral discovery"]
  end

  Completed --> CompletedDelivery
```

---

## Progress & Completed Tasks

### Track 3 (SPI Slice): Pluggable Team Topology Contracts
- [x] **3.1 Topology SPI Contract (`lib/team-protocol-spi.ts`)**:
  - Implemented `TeamProtocolHandler`, `TeamModelSlot`, `TeamRunModels`, `TeamRunInput`, `TeamProtocolRunArgs`, and `TeamTopologyRegistry`.
- [x] **3.2 Protocol Handlers Registration**:
  - Refactored `consult`, `debate`, `fusion-analysis`, `hierarchical-swarm`, and `research` to register into `TeamTopologyRegistry`.
  - Validated zero regression across all 38 existing team tests.

### Track 6: Fast-Check Property Invariants
- [x] **6.1 Kanban Event Log Properties (`tests/kanban/pi-kanban-property.test.ts`)**:
  - Task ID formatting validation, log escaping, and agent sanitization property tests.
- [x] **6.2 Goal State Parser Properties (`tests/goal/pi-goal-property.test.ts`)**:
  - Valid state field preservation and invalid state error boundary resilience.

### Track 7: Automated AGENTS.md Directives
- [x] **7.1 Fitness Exception Ratchet (`tests/architecture/hotspots.ts`)**:
  - Monotonic ceilings: `LINE_BUDGET_EXCEPTIONS` ($\le 16$) and `COUPLING_BUDGETS` ($\le 12$).
  - Target-date expiry enforcement (fails if `targetDate < today`).
- [x] **7.2 Google TS Syntax Restrictions (`tests/architecture/ts-style-guard.ts`)**:
  - AST/token bans for `eval`, `Function`, `with`, `debugger`, `const enum`, `#private`, `I`-interfaces, and `@ts-ignore`.
- [x] **7.3 Dependency Bloat Allowlist (`tests/architecture/dependencies.ts`)**:
  - Strict ceiling: $\le 2$ production runtime dependencies (`@sinclair/typebox`, `matrix-js-sdk`).
- [x] **7.4 Desert Mode & Persona Noise Linter (`tests/architecture/prompt-hygiene.ts`)**:
  - Scans registered tool descriptions and prompt templates for conversational persona fluff.

---

## Active Refactor Queue

### Coordination Blockers

- [x] **Coordination Blockers** — none: ADR-047 pi-boost is complete and pushed to origin/main (`1e8cb50`). Hotspots, deterministic TUI/command work, layering, and EventLog/Kanban work are merged and validated.

### Track 1: High-Scoring Hotspot Decomposition

- [x] **1.1 Decompose `pi-goal/goal-extension.ts` (Score 2,113; 483 LOC; 84 branch points)** — **merged**:
  - Extracted slash command handlers and execution loop into `extensions/pi-goal/goal-commands.ts`.
  - Extracted runtime/UI/continuation helpers into `extensions/pi-goal/goal-runtime.ts`.
  - Entry point reduced to 99 LOC.
  - Merged to main: `8405804` (source `refactor/goal-hotspot` @ `961c05f`).
- [x] **1.2 Decompose `extensions/pi-panopticon/teams/state.ts` (Score 662; 543 LOC; 136 branch points)** — **merged**:
  - Extracted event contracts, JSON/JSONL codecs, and output bounds into `team-state-codecs.ts`.
  - Extracted event replay/reduction into `team-state-reducer.ts`.
  - State manager reduced to 250 LOC.
  - Merged to main: `8e59075` (source `refactor/teams-state-hotspot` @ `bec4987`).
  - Integration evidence: `git diff --check`, `npm test` (1,317 passed), and `npm run check` (99.23% type coverage) pass.
- [x] **1.3 Decompose `pi-coas/schedules.ts` & `scheduler.ts`** — **merged**:
  - Extracted schedule evaluation into `scheduler-evaluation.ts`.
  - Extracted dispatch handling into `scheduler-dispatch.ts`.
  - Merged to main: `a0a1d5e` (source `refactor/coas-scheduler-hotspot` @ `5c0d03f`).
  - Integration evidence: `git diff --check`, `npm test` (1,317 passed), and `npm run check` (99.23% type coverage) pass.
- [x] **1.4 Refactor `pi-kanban/snapshot.ts`** — **merged**:
  - Extracted snapshot and overlay view models (`snapshot-model.ts`, `overlay-model.ts`).
  - Merged to main: `4ef4587`.
  - Validation: `npm run check` (99.24% type coverage), `npm test` (1368 passed).
- **Validation Gate:** `npx vitest run tests/architecture/hotspots.ts && npm test`

---

### Track 2: TUI Testability & Coverage Desert Elimination

- [x] **2.1 Decouple TUI Renderers into Pure View-Models** — **merged**:
  - Goal overlay: `goal-render.ts` + `goal-overlay-render.test.ts`.
  - Panopticon UI: `agent-detail-model.ts`, `status-view-model.ts` + `ui-view-model.test.ts`.
  - Kanban overlay: `overlay-model.ts` + `pi-kanban-snapshot-render.test.ts`.
- [x] **2.2 Implement Deterministic TUI Snapshot Tests** — **merged**:
  - Snapshot tests in `tests/goal/goal-overlay-render.test.ts`, `tests/panopticon/ui-view-model.test.ts`, `tests/kanban/pi-kanban-snapshot-render.test.ts`.
- [x] **2.3 Command Unit-Test Harness** — merged:
  - Headless command-context fixtures cover command parsing and error responses in `pi-coas/commands.ts` and `pi-panopticon/ui/*-command.ts`.
- [x] **Coverage evidence:** `npm run test:coverage` passed (176 files / 1,380 tests). V8 reports module-level coverage: `pi-panopticon/ui` is 71.77% statements, while extracted deterministic view-model modules are 96.66–100%. The historical aggregate $>75\%$ UI/CLI target is not claimed as met and is not a relaxed fitness threshold; remaining interactive-shell coverage is follow-up work.

---

### Track 4: `lib/` Layering Cleanse & Multi-Tenant Discipline

- [x] **4.1 Relocate Single-Tenant Utilities** — merged:
  - Single-tenant CoAS/Panopticon helpers and CLI entrypoints were relocated to extension or script ownership.
- [x] **4.2 Enforce Multi-Tenant Rule in Fitness Tests** — merged:
  - `tests/architecture/lib-layering.ts` enforces shared `lib/` ownership.
- [x] **4.3 Define Clean Core Primitives in `lib/`** — merged:
  - `lib/` now contains only true shared primitives, including `event-log.ts` where it is used by Kanban.
- **Validation Gate:** `npx vitest run tests/architecture/lib-layering.ts && npm run check`

---

### Track 5: State Persistence & Write-Ahead Log (WAL) Consolidation

- [x] **5.1 Unified Event-Sourced Storage Primitive (`lib/event-log.ts`)** — merged:
  - Shared append-only WAL with atomic append, fsync, replay, snapshots, and locked compaction.
- [x] **5.2 Migrate Extensions to Shared Storage Primitive** — assessed and completed:
  - Kanban log appending and compaction use `lib/event-log.ts`.
  - Teams deliberately remains backed by host session custom entries: those entries are its durable session WAL and current-branch recovery source. A second file WAL would duplicate storage and change recovery semantics. Teams/event-log suites pass.
- **Validation Gate:** `npx vitest run tests/kanban/ tests/teams/ tests/shared/`

---

## Validation & Quality Gates

```bash
# 1. Full static analysis suite
npm run check

# 2. Complete unit, integration, and architecture fitness suite
npm test

# 3. Architecture fitness functions specifically
npx vitest run tests/architecture

# 4. Test coverage verification
npm run test:coverage
```

### Quantitative Success Criteria

| Metric | Baseline | Target |
|---|---|---|
| **Top Hotspot Score (`pi-goal`)** | 2,113 | $\le 600$ |
| **Largest File in Monorepo** | 544 LOC (`teams/state.ts`) | $\le 300$ LOC (0 budget exceptions) |
| **Line Budget Exceptions** | 16 exceptions | 0 exceptions (ratchet reduced) |
| **Coupling Budget Exceptions** | 12 exceptions | $\le 4$ exceptions |
| **Single-Tenant Files in `lib/`** | 15 files | 0 files |
| **TUI / Command Statement Coverage** | $< 10\%$ | $\ge 75\%$ |
| **Total Test Suite Time** | 3.85s | $\le 4.50s$ |
| **Type Coverage** | 99.22% | $\ge 99.2\%$ |
