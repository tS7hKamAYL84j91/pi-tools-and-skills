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

- `create-agent` skill (`/skill:create-agent`) guides agents through sidebar MCP creation and human-confirmed removal of independent standing panes, with registration verification and uncertainty/retry safeguards.
- Node Hub sidebar opt-in `--mcp-config <private-json>` adds loopback bearer tools `hub_list_agents`, `hub_create_agent`, `hub_close_agent`, and `hub_set_lead`. Keyboard/MCP share tab-bound validation, pane quotas, cancellation, and uncertainty inhibition; mutations use bounded instance-scoped deduplication. New creates independent default-model panes (not proof of Hub registration); Close requires human `c` then `y`; Lead stays panel-local. Provisioning is explicit, with no live settings changes or same-UID isolation. `HUB_SIDEBAR_TOKEN` is scrubbed from Node/Rust New and shared RPC/team child environments; trusted gate opt-outs remain. See [usage and limits](agent-hub-pane/README.md#tab-scoped-mcp-opt-in).
- `prompts/` commands `/catch-up [base-ref]` and `/catch-up-and-refactor [base-ref]`: read-only branch catch-up (intent, what landed, what is unfinished, next steps) and catch-up followed by a bounded KISS/YAGNI/DRY refactor. Base ref defaults to `origin/main`; release notes are `CHANGELOG.md` `## [Unreleased]`; Python gates are absent here and are recorded as absent, not invented. `tests/prompt-templates.test.ts` requires frontmatter `description` plus a body on every `prompts/*.md`, so a stray Markdown file fails `npm test`.
- Agent Hub publishes optional `zellij: { sessionName, paneId }` agent-location hints for external UIs, including an agent-list pane per tab. Headless/RPC children omit them; hints are advisory, not authority. See [Zellij integration](extensions/pi-agent-hub/README.md#zellij-integration) for the record format and consumer requirements.
- Local direct-vs-Goal ARM64 benchmark (frozen official-test judging, authored-test mutation checks, ten-problem continuation bundle); dry-run default, never submits to Exercism.
- `fleet-mcp` bounded v1 Fleet MCP server (`fleet-mcp/index.ts`, `FLEET_MCP_CONFIG` JSON): tools `fleet_register_external`, `fleet_agents`, `fleet_send`, `fleet_inbox`, `fleet_ack`, `fleet_unregister_external`, `fleet_status` over Agent Hub external registrar + Maildir; stdio default, loopback-only bearer HTTP (>=16 chars), absolute-root/bounded-limit/single-principal validation, atomic idempotent receipts (`0600`/`0700`), redacted errors; deployment/Tailscale/multi-principal out of scope.
- `spawn_agent` accepts an optional `capsule` — a compressed session handoff rendered into the child system prompt as an explicitly-labelled, secret-redacted, 4,000-char-bounded background block; `brief.context` stays the task-scoped field.
- `pi-overview` extension: one read-only `/overview` command for the current TUI session — git branch, uncommitted count, last six commits, session/model, context usage, session-entry count, and `docs/decisions.md` count; snapshot gathered on demand with fixed git commands and a bounded decision-log read, rendered width-bounded in the host theme, single-line notification fallback when `ctx.mode !== "tui"`. It adds wiring only: no chat loop, no process, no session creation, no writes.
- Maildir envelopes carry optional descriptive metadata: `type` (`message` | `request` | `reply` | `notification`, default `message`), `inReplyTo`, `correlationId`; set via `agent_send` or Fleet `fleet_send` (`in_reply_to`, `correlation_id`), surfaced to receivers by `message_read` as `[request; reply-to=…; correlation=…]` and by `fleet_inbox` as `type`/`in_reply_to`/`correlation_id`. `from` stays harness-populated (`senderId` is canonical but unauthenticated provenance); legacy envelopes read as ordinary messages; stored metadata is normalized on read (trimmed, vocabulary-checked for `type`, unknown/forged values dropped, and bounded to 256 characters on both write and read so a mailbox writer cannot store a multi-KB `inReplyTo`/`correlationId`), types are never inferred from prose, and metadata triggers no execution, permissions, scheduling, or workflow state; Fleet idempotency fingerprints keep the raw caller correlation when it carries content (so padded pre-upgrade receipts replay) while the stored payload stays trimmed and blank still equals absent; replay also accepts the previous release's empty-string correlation slot (`""`) as equivalent to `null`, without weakening any other fingerprint mismatch; `message_read` renders `id=<filename>` first in the tag block so `inReplyTo` is reachable, and rendering comes from the receiving session's loaded code (pre-upgrade sessions omit unknown tags until restarted).

### Fixed

- `/boost <prompt>` now renews the lease timer and yield budget even before expiry or after exhaustion; explicit `plan`/`challenge` prompts do likewise. Context-only modes retain their budget cap, failed dispatch restores the previous lease, and in-flight/restore-failure blocks remain enforced.
- Agent Hub native pane controls reject confirmations before preparation finishes or after the confirmation receipt expires; early input is not queued, and origin/replay checks remain enforced.
- Agent Hub duplicate roots no longer publish or reserve a collided declared lead label; resumed aliases retain a claim only when the declared label is available.
- Matrix module-global SDK logging is silenced so queue/event housekeeping (e.g. "Stopping queue 'message' as it is now empty") no longer reaches the console or pi's TUI; warn/error still route to the extension notify path.

### Changed

- Local RPC workers move from Agent Hub into independently loadable [`pi-subagents`](extensions/pi-subagents/README.md); `spawn_agent`, `rpc_send`, `list_spawned`, and `kill_agent` schemas are unchanged. Enable both extensions for the previous combined surface; live settings are not migrated. Optional private, bounded identity reads and a shutdown barrier preserve namespaces and child-before-transport teardown.
- Make targets mirror `package.json` and CI: `ci`, `build`, `semgrep-scan`, `audit`, `test-coverage`, `check-package-imports`. `make setup`/`make setup-clean` accept `PROJECT=<dir>` to read and write `<dir>/.pi/settings.json` (default global `~/.pi/agent/settings.json`; a missing directory fails instead of creating one). `pi-boost` and `pi-overview` are user-installable, pinned by tests that require every `extensions/*/package.json` to be classified and the make help to advertise the helper's list.
- `prompts/README.md` removed: Pi loads every `.md` under `prompts/` as a command, so it shipped as `/README`. `/commit-and-push` gains changelog, docs-match and clean-tree pre-flight. Root README simplified and notes that Zellij and Fleet config are not in this repository.
- Kanban reads fail loud on an event line whose `v` exceeds this build's version (`KanbanEventVersionError`) instead of silently dropping it; malformed lines at a known version are counted and surfaced as `skippedEvents` in `kanban_export_json`. `kanban_create` accepts optional `discovered_from: T-NNN` (validated parent), recorded as create-event provenance and exported as `discoveredFrom`.
- Kanban's authoritative log is now typed JSONL: `board.events.jsonl` holds one versioned (`v: 1`), schema-validated event per line (`create | move | claim | unclaim | expire | complete | block | unblock | note | delete | edit`). The space-delimited text `board.log` reader and its quote/checks escaping are removed; migrate an existing board once with `node scripts/migrate-kanban-log.mjs <kanbanDir>` (archives the old log).
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
- Boost restores the baseline model on Pi's `agent_settled` boundary (not polling after `agent_end`); Goal, Subagents RPC waits and Automations finalize on the same boundary.
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
