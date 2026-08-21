# Sparse Priming Representation (SPR) Planning Archive

Dense semantic mapping of completed development tracks, core invariants, historical decisions, and architectural boundaries.

---

## [SPR-BOOST-Q] Standing Boost Authority & Q-Control (Ref: T-839/T-843/T-846/T-847/T-848/T-849)

### 1. Core Concepts & Context
- **Boost Lease & WAL:** Bounded lease for Principal-authorized capability escalation. Writes ahead to in-memory Write-Ahead Log (WAL) to ensure rollback safety; audit logs are strictly redacted of all transient parameters and tokens.
- **Fail-Closed Release:** Any lease timeout, constructor failure, or runtime interruption triggers an automatic, verified rollback to standard unescalated capability states.
- **Q-Control Adapter:** Strict constructor-bound validation that maps the trusted environment config, enforces environment-native permissions, and wraps RPC messages. Model-selected overrides or caller-injected commands are rejected at the constructor level.

### 2. Standalone pi-boost Boundary
- In-memory authority states and lease validation remain private to `pi-boost`; `pi-panopticon` only exposes an inert command registration surface and handles host-injected boot capabilities during initial setup.
- The Boost extension exposes no global files, does not hook into external cron intervals, and has zero dependency on persistent database daemons.

### 3. Decisions & Invariants
- **No Path Overrides:** Public `modelsPath` or `ollamaCommand` inputs are entirely ignored; only operator environment variables (`PI_OLLAMA_COMMAND`) configuration is trusted.
- **Environment Confinement:** The lease never creates repository-relative files or writes to `.pi/coas/` configuration. All transient credentials live only in unexportable local state.

### 4. Verification Command
- `npx vitest run tests/panopticon/boost-lifecycle.test.ts tests/shared/test-quality.test.ts`

---

## [SPR-SWARM] Bounded Swarm Orchestration (Ref: SWARM/SWARM_DECLARATIVE_TEAM_PROTOCOL/SWARM_HIERARCHICAL_ORCHESTRATION/SWARM_ORCHESTRATOR_COMPLETION)

### 1. Core Concepts & Context
- **Task-Tree Decomposition:** Split high-entropy user goals into independent leaf-agent briefs with strict input declarations.
- **Bounded Worker Pool:** Task-scoped leaf runners run concurrently; worker pool sizes are strictly bounded (WIP $\leq$ 3) to prevent token and process exhaustion.
- **Stacked-Review Gates:** Artifact verification is mandatory before leaf completion is registered. Leaf results require synthesis and an independent evaluator-node consensus check before being promoted to the parent.
- **Non-Persistent Observability:** Subscriptions to swarm progress live entirely in-memory; transient progress widgets are refreshed via transient event publishers and are never serialized or persisted to disk.

### 2. Decisions & Invariants
- **No Dynamic DAGs:** The orchestration is a restrained, direct protocol loop; no dynamic compilation of workflows or generic DAG runners are introduced.
- **Immediate Cancellation:** Cancellation signals (`AbortSignal`) propagate immediately (within 500 ms) to all child subprocess PIDs, triggering graceful child exit and rollback.
- **Dry-Run Default:** `/swarm` commands and `swarm_run` tools default to dry-run-only to preview plans before burning model tokens or spawning processes.

### 3. Verification Command
- `npx vitest run tests/panopticon/swarm-e2e.test.ts tests/panopticon/swarm-tools.test.ts`

---

## [SPR-TEAMS-EXTRACTION] Standalone pi-teams Boundary (Ref: TEAMS-FIRST-TODO/TEAMS-FIRST-BOUNDARY/TEAMS-FIRST-EXTRACTION/TEAMS-SPI-REINTEGRATION/ADR-048)

### 1. Core Concepts & Context
- **Standalone pi-teams Extension:** Modular extraction of declarative teams, profiles, hierarchical swarm compatibility, and custom event handlers from `pi-panopticon` into `extensions/pi-teams`.
- **Direct Protocol Handlers:** Preserved direct registries (`TEAM_HANDLERS`) and static topology functions for navigator, council, fusion, and research protocols. No generic runtime SPI.
- **Private Spawner:** `pi-panopticon` retains its private RPC spawner. `pi-teams` uses its own small, lightweight pi-binary resolver (`resolvePiBinary`) to run one-shot background child processes.
- **Idempotent Seeding:** Packaged team specs (seeds) under `pi-teams/config/` project verbatim on session start into the configured user team root (`~/.pi/agent/teams`). Existing user/project overrides are never overwritten.

### 2. Decisions & Invariants
- **No Private Cross-Extension Imports:** `pi-panopticon` has zero Teams/Swarm imports or registration code; `pi-teams` imports only from neutral `lib/` capabilities and does not require Panopticon.
- **Stable State Schema:** Team run state is persisted in the session tree as neutral custom events (`pi-teams:run`) using stable `schemaVersion: 1` event envelopes.
- **Private Claims Root:** Result claim-checks are written only to the configured private results directory (`~/.pi/agent/teams/results`), which is protected with `0700` directories and `0600` files. No repo-relative or CoAS directories are used.

### 3. Verification Command
- `npx vitest run tests/architecture tests/shared/extension-registration.test.ts`

---

## [SPR-LIB-CLEANSE] Monorepo Library Layering (Ref: track-4-lib-cleanse/ARCHITECTURE-REFACTOR-QUEUE)

### 1. Core Concepts & Context
- **Clean Lib Layering:** Complete sanitization of cross-extension and cross-module circular imports. Decoupled extension modules from core runtime state boundaries.
- **Shared Discovery (ADR-047):** Layered team descriptor paths and markdown discovery migrated to neutral `lib/declarative-discovery.ts` so both `pi-teams` and `pi-boost` consume shared logic without circular dependencies.
- **CoAS Governance Isolation (ADR-035):** Environment-level model classification and local trigger resolution migrated to `lib/coas-governance.ts` so both `pi-coas` and `pi-teams/swarm` use the same trusted trigger boundary.

### 2. Decisions & Invariants
- **No Exception-List Bypass:** Failing fitness or layer tests must be resolved via refactoring or neutral helper extraction, never by adding the failing file to architecture exception lists.
- **Strict Quality Gates:** Enforce strict type-safety boundaries in every user/global extension: minimum 95% type coverage and clean `npm run knip` dead-code audits.

### 3. Verification Command
- `npm run check`
