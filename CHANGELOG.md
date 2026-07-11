# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

### Security

- Removed the `matrix-bot-sdk -> request -> request-promise` dependency chain; production `npm audit --omit=dev --audit-level=high` now reports zero findings.
- Matrix diagnostics redact access tokens, bearer tokens, and terminal escape sequences.

### Changed

- `fail()` in `lib/tool-result.ts` now accepts `FailureDetails` while remaining backward compatible with arbitrary `Record<string, unknown>` details.

## [1.1.0] - 2026-06-24

### Added

- Initial release of the SOTA readiness tracking report and architecture fitness gates.
