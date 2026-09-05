# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `fleet-mcp`: bounded v1 Fleet MCP server (`fleet-mcp/index.ts`, `FLEET_MCP_CONFIG` env JSON) exposing `fleet_register_external`, `fleet_agents`, `fleet_send`, `fleet_inbox`, `fleet_ack`, `fleet_unregister_external`, and `fleet_status` over the existing Panopticon external registrar and Maildir transport. Stdio transport by default; optional HTTP transport is loopback-only and requires a configured bearer token (>=16 chars). Config validation enforces absolute roots, bounded page/text/ack limits, and fixed single-principal ownership; idempotent send receipts and registrations persist atomically (0600 state, 0700 dir) with redacted MCP error responses. Deployment/Tailscale/multi-principal identity provisioning is explicitly out of scope.

### Changed

- Plain `/goal run` now defaults to a bounded 20-turn continuous run; use `--turns N` for an explicit shorter run (ADR-055).
- pi-boost no longer ships hard-coded provider/model defaults: unconfigured boost settings plan from the host model registry's text-capable models (`ctx.modelRegistry.getAvailable()`), with a warned auto fallback and fail-closed behavior when no usable model exists; stale explicit selections are never silently substituted. `/boost` settings gains a registry-backed multi-select model list (capped at 4, empty = auto). Single mode remains one model with no judge; fusion stays explicit (ADR-056).

## [1.2.0] - 2026-09-01

### Added

- Matrix extension now uses `matrix-js-sdk@41.9.0` instead of the deprecated `matrix-bot-sdk@0.8.0`.
- Internal `MatrixClientAdapter` boundary so the bridge depends only on a narrow adapter interface.
- `FileSyncStateStore` for atomic, permission-restricted, symlink-rejected Matrix sync-token persistence with corrupt-state quarantine.
- Bounded Matrix ingress policy (`maxBuffer`, `globalBurstLimit`, `perSenderBurstLimit`, `rateWindowMs`, `overflowPolicy`) with redacted diagnostics.
- `engines.node: ">=22"` declared in the root package and every extension manifest.
- `coverage/` ignored by git.
- Structured tool-failure metadata (`FailureDetails`) with optional `code`, `retryable`, `action`, `schemaVersion`, `truncated`, and `correlationId`.
- Deterministic behavioral evaluation harness under `tests/evals/` with tool-selection and team-routing fixtures.
- CI workflow covering namespace/type/lint/knip/coverage checks, Node 22/24/25 compatibility, production audit, gitleaks secret scan, and per-package install smoke tests.
- `lib/daemon-protocol/` published daemon protocol surface (ADR-053): paths, capability proof with `AdmissionScope`, registry types, wire codec, and `RegistryEventBuffer` — `pi-panopticon` and per-extension installs now resolve without the private systemd-deployed daemon.
- ADR index (`docs/adr/README.md`) documenting the 024/033 numbering collisions, the 020/028 gaps, and the next sequential ADR slot.
- Architecture guard test enforcing zero `daemon/src` imports inside `lib/daemon-protocol/`.

### Security

- Removed the `matrix-bot-sdk -> request -> request-promise` dependency chain; production `npm audit --omit=dev --audit-level=high` now reports zero findings.
- Matrix diagnostics redact access tokens, bearer tokens, and terminal escape sequences.

### Changed

- `fail()` in `lib/tool-result.ts` now accepts `FailureDetails` while remaining backward compatible with arbitrary `Record<string, unknown>` details.
- `fitness.yml` now runs only the architecture-fitness suites instead of duplicating the full CI check+test run; `actions/checkout` is commit-SHA-pinned in both workflows; the `install-smoke` matrix covers all 11 extension packages plus the root.
- Biome lint scope extended to `scripts/`; knip entry extended to `scripts/*.mjs` (closes the orphan-script blind spot).
- `README.md` prerequisites clarified (Python 3 is only needed for `security:semgrep`); `package.json` `description`/`author` filled.
- `extensions/pi-panopticon/README.md` drops the provisional MEMORY.md surface references.

### Removed

- Retired `pi-bionic`, `pi-doctor`, and `pi-event-loop` extensions, manifests, tests, fixtures, examples, and operator documentation; the retained CoAS scheduler is now exposed as `pi-scheduler`.
- Removed the superseded hierarchical Teams/swarm runtime, compatibility commands/tools, manifests, and tests; retained `pi-teams` now provides only consult, debate, and research protocols.
- Test-only production modules removed per ADR-054 with their tests and fixtures: `pi-teams/worktree-isolation.ts`, `pi-panopticon/ui/memory-renderer.ts`, `pi-panopticon/ui/memory-writer.ts`, and `pi-kanban/lifecycle.ts`; the pi-teams `node:child_process` boundary is now zero. The no-exemptions test-only-import fitness rule is implemented and lands with the remaining module dispositions (tracked separately).
- Unreferenced scripts removed: `scripts/session-spool-hook.mjs` (ADR-017 POC) and `scripts/t851-artifact-smoke.sh`.

## [1.1.0] - 2026-06-24

### Added

- Initial release of the SOTA readiness tracking report and architecture fitness gates.
