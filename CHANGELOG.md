# Changelog

Notable changes as SPR (Sparse Priming Representation) lines: dense, complete
facts for an LLM audience. Exact identifiers (versions, dates, commands, tools,
env keys, ADR numbers) are preserved; full prose rationale lives in Git history
(`git log --all -S <topic>`). [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
structure and [Semantic Versioning](https://semver.org/spec/v2.0.0.html) apply.

## [Unreleased]

### Removed

- `abbs-fleet` skill removed (CoAS-private operations guidance, unfit for the published package); `worktree-isolation` de-internalised.
- Automations daemon, systemd unit, Agent Hub daemon client, published daemon protocol + tests/build config removed; Agent Hub = file-backed registry + Maildir only, Automations = Pi-hosted scheduler only, no daemon mode/flag/compat layer.
- Style-only architecture fitness tests removed (`clean-code.ts`, `ux-tools-policy.ts`, doc-count/archive/SPR-format checks in `docs-hygiene.ts`); relative-link validation retained.

### Added

- Local direct-vs-Goal ARM64 benchmark (frozen official-test judging, authored-test mutation checks, ten-problem continuation bundle); dry-run default, never submits to Exercism.
- `fleet-mcp` bounded v1 Fleet MCP server (`fleet-mcp/index.ts`, `FLEET_MCP_CONFIG` JSON): tools `fleet_register_external`, `fleet_agents`, `fleet_send`, `fleet_inbox`, `fleet_ack`, `fleet_unregister_external`, `fleet_status` over Agent Hub external registrar + Maildir; stdio default, loopback-only bearer HTTP (>=16 chars), absolute-root/bounded-limit/single-principal validation, atomic idempotent receipts (`0600`/`0700`), redacted errors; deployment/Tailscale/multi-principal out of scope.
- `spawn_agent` accepts an optional `capsule` — a compressed session handoff rendered into the child system prompt as an explicitly-labelled, secret-redacted, 4,000-char-bounded background block; `brief.context` stays the task-scoped field.

### Fixed

- Matrix module-global SDK logging is silenced so queue/event housekeeping (e.g. "Stopping queue 'message' as it is now empty") no longer reaches the console or pi's TUI; warn/error still route to the extension notify path.

### Changed

- CI tests on the latest Node only; Node 22/24/25 compatibility matrix removed.
- Deliberate stops (`kill_agent`, session shutdown) mark an expected exit, so they no longer raise the missing-DONE follow-up; unexpected exits still notify.
- Distribution Git-only: npm publishing, tag-triggered `release` matrix, vendor-at-pack staging and `dist-npm/` removed; per-extension `package.json` keeps path/`git:` install; release = verified tag.
- Decision log = one SPR line per decision, absorbing the removed `docs/specs/`; `tests/architecture/docs-hygiene.ts` validates relative links in tracked Markdown (fenced code excluded).
- Goal completion runs the workspace-local `.pi/goal/settings.json` hook (evidence prose cannot complete); one bounded run/request, missing/invalid/failed/timeout leaves the goal open, genuine blockers pause via `goal_block`, liveness warnings never interrupt work.
- `pi-coas` → `pi-automations` hard cutover: tools `coas_*`→`automations_*`, commands `/coas`→`/automations(-status|-doctor|-workspaces|-schedules)`, env `COAS_*`→`AUTOMATIONS_*`, settings `coasProfile`→`automationsProfile`, state `.pi/coas`→`.pi/automations` (default `<cwd>/.pi/automations`, `AGENT_HOME` fallback removed); explicit-cwd needs an existing runtime (ADR-062).
- Goal keeps original file sources and writes only `goal.json` + one active `GOAL.md`; generated TODO/SPEC/PLAN/STATUS scaffolding and plan/approve no-ops removed; sources/history/safety controls intact.
- Team Workflows: one session-backed run/status/stop authority (`team_run`, `team_runs`, `team_stop`, `/teams run|async|status|stop`); `/team` interception modes, redundant runtime tools and typo/implicit aliases removed; async shares the tool delivery path; terminal-run stops rejected without history change; model bindings/profiles unchanged.
- Kanban views read-only; JSON export kept, Markdown/snapshot export + snapshot-only modules removed; `kanban_compact` is the sole compaction trigger, explicit compaction keeps unique backups.
- Automations schedules session/workspace-scoped and model-agnostic: no model snapshot at creation, scheduler unsubscribed from `model_select`, model changes never skip due runs; legacy `MODEL_SNAPSHOT`/`skipped-drift` readable but inert.
- `pi-panopticon`→`pi-agent-hub`, `pi-teams`→`pi-team-workflows` (directory/package names only; tools/commands/config keys/persisted identifiers unchanged, ADR-064).
- Host dependency/toolchain aligned to Pi 1.0.1: Pi/TUI dev deps + peers `^1.0.1`, schema imports use host `typebox`, `engines.node` `>=22.19`.
- Boost restores the baseline model on Pi's `agent_settled` boundary (not polling after `agent_end`); Goal, Agent Hub RPC waits and Automations finalize on the same boundary.
- `fleet-mcp` refactored into config/state-store/gateway-policy/Maildir-backend/MCP-transport/runtime-lifecycle layers: uniform-ESM build/run, fixed-principal schemas (no caller `client_key`), serialized mutations, durable ack/unregister tombstones, strict HTTP, accurate readiness, graceful shutdown, documented deployment boundaries.
- `/goal <text>` and `/goal file <path>` run immediately to evidence-based completion; planning/milestone-verification/approval tools + plan/approve no-ops removed; plain run/resume = unbounded persisted sentinel, `--turns N` = explicit 1–20 turns; ownership/stop/pause/session-replacement/liveness-containment/local completion hook enforced.
- pi-boost ships no hard-coded provider/model defaults: unconfigured settings plan from host-registry text-capable models (`ctx.modelRegistry.getAvailable()`), warned auto fallback, fail-closed when none usable, stale explicit selections never substituted; `/boost` gains a registry-backed multi-select (cap 4, empty = auto); single mode = one model, no judge; fusion explicit (ADR-056).

## [1.2.0] - 2026-09-01

### Added

- Matrix: `matrix-js-sdk@41.9.0` replaces deprecated `matrix-bot-sdk@0.8.0`.
- `MatrixClientAdapter` boundary: bridge depends only on a narrow adapter interface.
- `FileSyncStateStore`: atomic, permission-restricted, symlink-rejected Matrix sync-token persistence with corrupt-state quarantine.
- Bounded Matrix ingress policy (`maxBuffer`, `globalBurstLimit`, `perSenderBurstLimit`, `rateWindowMs`, `overflowPolicy`) with redacted diagnostics.
- `engines.node: ">=22"` in the root package and every extension manifest.
- `coverage/` git-ignored.
- Structured tool-failure metadata `FailureDetails` (`code`, `retryable`, `action`, `schemaVersion`, `truncated`, `correlationId`).
- Deterministic behavioral evaluation harness under `tests/evals/` (tool-selection + team-routing fixtures).
- CI: namespace/type/lint/knip/coverage checks, Node 22/24/25 compatibility, production audit, gitleaks secret scan, per-package install smoke tests.
- `lib/daemon-protocol/` published surface (ADR-053): paths, `AdmissionScope` capability proof, registry types, wire codec, `RegistryEventBuffer`; `pi-panopticon` + per-extension installs resolve without the private systemd daemon.
- ADR index (`docs/adr/README.md`): 024/033 numbering collisions, 020/028 gaps, next sequential slot.
- Architecture guard test: zero `daemon/src` imports inside `lib/daemon-protocol/`.

### Security

- Removed the `matrix-bot-sdk -> request -> request-promise` chain; production `npm audit --omit=dev --audit-level=high` = zero findings.
- Matrix diagnostics redact access/bearer tokens + terminal escape sequences.

### Changed

- `fail()` in `lib/tool-result.ts` accepts `FailureDetails`, backward-compatible with arbitrary `Record<string, unknown>` details.
- `fitness.yml` runs only architecture-fitness suites (no duplicate check+test); `actions/checkout` SHA-pinned in both workflows; `install-smoke` matrix = all 11 extension packages + root.
- Biome lint scope extends to `scripts/`; knip entry extends to `scripts/*.mjs` (closes the orphan-script blind spot).
- `README.md` prerequisites clarified (Python 3 only for `security:semgrep`); `package.json` `description`/`author` filled.
- `extensions/pi-panopticon/README.md` drops provisional MEMORY.md surface references.

### Removed

- Retired `pi-bionic`, `pi-doctor`, `pi-event-loop` (extensions/manifests/tests/fixtures/examples/operator docs); retained CoAS scheduler exposed as `pi-scheduler`.
- Removed the superseded hierarchical Teams/swarm runtime + compatibility commands/tools/manifests/tests; retained `pi-teams` = consult/debate/research only.
- Removed test-only production modules per ADR-054 (+ tests/fixtures): `pi-teams/worktree-isolation.ts`, `pi-panopticon/ui/memory-renderer.ts`, `pi-panopticon/ui/memory-writer.ts`, `pi-kanban/lifecycle.ts`; pi-teams `node:child_process` boundary now zero; the no-exemptions test-only-import rule lands with the remaining dispositions (tracked separately).
- Removed unreferenced scripts `scripts/session-spool-hook.mjs` (ADR-017 POC) and `scripts/t851-artifact-smoke.sh`.

## [1.1.0] - 2026-06-24

### Added

- Initial release: SOTA readiness tracking report + architecture fitness gates.
