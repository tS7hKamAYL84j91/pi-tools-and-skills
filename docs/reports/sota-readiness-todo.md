# SOTA Readiness and Matrix Migration TODO

Status: active
Date: 2026-07-11
Owner: pi-tools-and-skills maintainers
Scope: reliability, security, evaluation, discoverability, compatibility, and release readiness

## Goal

Make the tools and skills release-ready and measurably reliable without adding a generic workflow framework, durable telemetry service, or speculative persistence layer.

## Current baseline

- `npm run check` passes with 99.33% type coverage.
- `npm test` currently fails because the `lib/ must not import from extensions/` architecture test exceeds Vitest's default 5-second timeout. The full 880-test suite passes with `--testTimeout=15000`.
- `npm audit --omit=dev --audit-level=high` reports 13 production dependency findings, including 2 critical findings through `matrix-bot-sdk -> request -> form-data`.
- `matrix-bot-sdk@0.8.0` is already the latest package release. Element's `@vector-im/matrix-bot-sdk@0.9.0-element.1` still depends on `request` and `request-promise`.
- A clean production audit of `matrix-js-sdk@41.9.0` reported zero vulnerabilities on 2026-07-11.
- `MatrixBridgeClient` already isolates the external SDK primarily behind `extensions/pi-matrix/client.ts`.

## Priority summary

| Priority | Workstream | Ship condition |
| --- | --- | --- |
| P0 | Migrate Matrix SDK | Required before release while the critical runtime dependency findings remain |
| P0 | Make the default test gate deterministic | Required before release |
| P1 | Make Matrix buffering and ingress failure visible and bounded | Required for reliable external messaging |
| P1 | Harden CI and compatibility checks | Required for repeatable release evidence |
| P1 | Make `pi-doctor` the authoritative capability auditor | Required before generated discovery metadata |
| P2 | Add behavioral evaluations for tools, skills, and team protocols | Required for a defensible SOTA claim, not an immediate security blocker |
| P2 | Generate skill/capability discovery metadata | Follow-up after the doctor inventory is authoritative |
| P2 | Standardize structured tool failures and diagnostics | Incremental compatibility-safe improvement |
| P2 | Establish release and maintenance policy | Required before wider distribution |

---

## P0.1 — Migrate `pi-matrix` to `matrix-js-sdk`

### Decision

Prefer migration to the actively maintained `matrix-js-sdk` over forking `matrix-bot-sdk`.

A fork is the fallback only if a bounded spike proves that `matrix-js-sdk` cannot provide reliable headless sync-token persistence, restart behavior, or an acceptable runtime footprint. If a fork becomes necessary, fork Element's repository, keep the patch limited to replacing the deprecated HTTP layer, and submit the change upstream.

### Constraints

- Preserve the current `MatrixBridgeClient` public behavior.
- Continue supporting Node.js 22+.
- Preserve the trusted-sender and invitation policies.
- Preserve attachment MIME, size, filename, and path controls.
- Do not enable end-to-end encryption in this migration; current deployment uses unencrypted rooms on a private tailnet.
- Do not introduce a database solely for Matrix sync state.
- Do not replay historical messages after restart.
- Keep credentials and raw message content out of diagnostics and fixtures.

### Phase A — Characterize the existing contract

- [ ] Add adapter-level tests for `MatrixBridgeClient.start()`, `send()`, `sendTo()`, `stop()`, and `isConnected()`.
- [ ] Lock trusted invite acceptance, untrusted invite rejection, own-message rejection, and trusted-sender filtering in tests.
- [ ] Lock text, notice, emote, and attachment event conversion in tests.
- [ ] Lock startup failure, malformed event, handler failure, and graceful-stop behavior.
- [ ] Add duplicate-event and restart/replay fixtures.
- [ ] Record the expected mapping between SDK events and the existing `InboundMessage` interface.

### Phase B — Introduce an internal SDK boundary

- [ ] Define a narrow internal client interface for start, stop, join, leave, send, sync events, membership events, and sync-token access.
- [ ] Keep Matrix SDK-specific event objects inside the adapter.
- [ ] Replace `AnyClient` where practical with local structural interfaces or imported SDK types.
- [ ] Ensure `attachments.ts` depends only on the narrow download/crypto capability interface it needs.

### Phase C — Implement the `matrix-js-sdk` adapter

- [ ] Replace dynamic `matrix-bot-sdk` loading with `matrix-js-sdk` loading.
- [ ] Construct the client with `createClient({ baseUrl, accessToken, userId, ... })`.
- [ ] Map startup to `startClient()` and wait for a prepared sync state with a bounded timeout.
- [ ] Map shutdown to `stopClient()` and make repeated stops safe.
- [ ] Map invitations through membership events and retain `shouldJoinMatrixInvite()` policy.
- [ ] Map new room messages through timeline events; ignore historical/back-pagination events and local echoes.
- [ ] Map outbound Markdown content through `sendEvent()` while preserving returned event IDs.
- [ ] Preserve authenticated, size-bounded media downloads.
- [ ] Route SDK warnings/errors through existing sanitized Matrix diagnostics.

### Phase D — Persist sync safely

- [ ] Add the smallest supported persistent sync-token mechanism under the configured `storagePath`.
- [ ] Use atomic private-local file writes and reject symlinked state paths.
- [ ] Verify that restart resumes from the last acknowledged sync token without replaying messages.
- [ ] Define behavior for corrupt or incompatible sync state: quarantine/reset with a visible recovery action, never silently loop.
- [ ] Ensure only one active Matrix client writes a given sync state path.

### Phase E — Reliability and security verification

- [ ] Test homeserver unavailability, token rejection, rate limiting, reconnect, reload, and shutdown during long-poll sync.
- [ ] Test invitation and message floods against the ingress limits in P1.1.
- [ ] Run a manual homeserver smoke test covering invite/join, inbound/outbound rich text, attachment download, reconnect, and restart without replay.
- [ ] Run a bounded secret scan over changed Matrix files.
- [ ] Remove `matrix-bot-sdk` from `package.json` and `package-lock.json`.
- [ ] Confirm `npm audit --omit=dev --audit-level=high` has no high/critical production findings, or document a reviewed exception with reachability evidence and expiry.
- [ ] Run `npm run check`, `npm test`, and `npm run test:coverage`.

### Rollback

Keep the migration as one dependency/adapter change with no state-format destruction. If rollback is required, preserve the old sync file until the new adapter has completed a successful prepared sync and restart test. Do not maintain both SDKs as a permanent runtime toggle.

### Acceptance criteria

1. All existing Matrix behavior remains available through the same extension tools and commands.
2. A restart does not replay already-consumed events.
3. Startup, reconnect, rate-limit, and shutdown failures are bounded and visible.
4. The deprecated `request`/`request-promise` dependency chain is absent.
5. Production audit, repository checks, and tests pass.

---

## P0.2 — Make the default test gate deterministic

- [x] Profile the slow ArchUnit rule in `tests/architecture/api-contracts.ts`; the first cold ArchUnit dependency scan legitimately exceeded Vitest's default 5-second per-test timeout.
- [x] Confirm repeated project-scan refactoring is not needed for this slice: the remaining rules complete within the default timeout after the initial scan.
- [x] Apply a focused 15-second timeout to the unchanged `lib/ must not import from extensions/` fitness rule.
- [x] Verify `npm test` passes repeatedly without relying on the coverage command's global timeout.
- [x] Keep the dependency-direction assertion unchanged.

Acceptance evidence (2026-07-11): three consecutive normal `npm test` runs passed, each with 106 files and 880 tests. A separate flaky goal-loop test exposed during repetition was stabilized with a bounded one-second polling deadline.

---

## P1.1 — Bound Matrix ingress and expose message loss

- [x] Replace silent `buffer.shift()` overflow in `extensions/pi-matrix/transport.ts` with an explicit overflow policy.
- [x] Add bounded counters and a visible warning containing counts, not message bodies.
- [x] Add configurable per-sender and global burst/rate limits with restrained defaults.
- [x] Emit a prominent diagnostic whenever `allowAnySender` is enabled.
- [x] Define whether overflow rejects newest messages or evicts oldest messages; document the selected policy.
- [x] Add tests for overflow, rate limits, sender isolation, recovery after the time window, and redacted diagnostics.

Deferred: persistent spill storage. Introduce it only after acknowledgement, retention, privacy, duplication, and cleanup semantics are approved in an ADR.

Acceptance: no inbound message can be discarded without a bounded, user-visible diagnostic.

Acceptance evidence (2026-07-11): `MatrixIngressLimiter` and `MatrixTransport` now enforce `maxBuffer`, `globalBurstLimit`, `perSenderBurstLimit`, and `rateWindowMs` with redacted diagnostics. The default `overflowPolicy` is `drop-newest` and is documented in `extensions/pi-matrix/SETUP.md`. `allowAnySender` emits a warning at startup. Tests cover buffer overflow, drop-oldest, global/per-sender limits, window recovery, sender isolation, and redacted diagnostics.

---

## P1.2 — Harden CI and compatibility evidence

- [ ] Add gitleaks scanning to CI using bounded repository-safe configuration.
- [ ] Add `npm audit --omit=dev --audit-level=high` to CI and define a time-bounded exception process for unreachable or unfixed findings.
- [ ] Pin third-party GitHub Actions to reviewed commit SHAs.
- [ ] Add supported Node.js compatibility jobs, initially Node 22, 24, and 25.
- [x] Add `engines.node` to the root and extension manifests where appropriate.
- [ ] Replace wildcard pi/pi-tui peer dependency ranges with tested compatibility ranges.
- [x] Add `coverage/` to `.gitignore`.
- [ ] Add risk-weighted coverage thresholds for executable security, persistence, spawning, Matrix, and lifecycle modules; do not penalize type-only files.
- [ ] Add a package-install smoke test for the root package and individually installable extension packages.

Acceptance: CI produces reproducible quality, security, compatibility, and installability evidence.

Progress (2026-07-11): `engines.node: ">=22"` added to the root package and all extension manifests; `coverage/` added to `.gitignore`. Remaining CI workflow, audit exception process, pinned Actions, Node compatibility matrix, peer-dependency ranges, risk-weighted coverage thresholds, and install smoke tests are in progress via Jules session 11898159472442819735.

---

## P1.3 — Make `pi-doctor` authoritative

- [ ] Include every shipped extension, including `pi-ollama-models`.
- [ ] Replace `index.ts`-only regex discovery with recursive, syntax-aware discovery or a generated registration manifest.
- [ ] Inventory every tool, command, skill, prompt, package entrypoint, and install scope.
- [ ] Record tool mutability, destructive confirmation, dry-run support, output bounds, and owning extension where applicable.
- [ ] Detect duplicate names, reserved names, missing package exposure, stale README entries, and manifest/source drift.
- [ ] Make the generated inventory deterministic and snapshot-test it.
- [ ] Keep doctor read-only.

Acceptance: a newly registered nested tool or skill is discovered automatically and documentation drift fails validation.

---

## P2.1 — Add behavioral evaluation

- [ ] Create versioned evaluation fixtures for representative tool and skill tasks.
- [ ] Measure correct tool/skill selection, task success, instruction adherence, false triggers, unnecessary tool calls, output size, and latency.
- [ ] Add adversarial fixtures for prompt injection, untrusted Matrix content, malicious filenames, path traversal, and oversized output.
- [ ] Add protocol evaluations for navigator, council, fusion, and deep-research routing and synthesis quality.
- [ ] Separate deterministic CI evaluations from provider/model-dependent nightly evaluations.
- [ ] Record model, prompt/config version, score, latency, and failure category without retaining secrets or raw private sessions.
- [ ] Define regression budgets and an explicit approval process for intentional score changes.

Acceptance: claims of improvement can be supported by repeatable before/after task outcomes, not only implementation coverage.

---

## P2.2 — Generate skill and capability discovery metadata

Dependency: complete P1.3 first.

- [ ] Generate a machine-readable skill index containing at least `id`, `path`, `description`, `bundle`, `entry`, and `version`.
- [ ] Include trigger summary, required tools, compatibility, and verification command when declared.
- [ ] Generate README skill and extension tables from the same source of truth.
- [ ] Validate frontmatter, directory/name agreement, broken references, trigger clarity, and duplicate descriptions.
- [ ] Consider a read-only `/skills` or doctor view only after a concrete consumer exists.

Acceptance: humans and agents can discover the same complete, current capability set without scanning directories.

---

## P2.3 — Standardize structured tool failures and bounded diagnostics

- [x] Extend `lib/tool-result.ts` additively with stable optional fields such as `code`, `retryable`, `action`, `schemaVersion`, `truncated`, and correlation/run ID.
- [x] Preserve concise human-readable text and backward compatibility.
- [x] Adopt the fields first at external boundaries and destructive operations.
- [x] Reuse existing session journal and team observability primitives before creating new infrastructure.
- [x] Keep diagnostics opt-in, bounded, redacted, and ephemeral unless explicitly exported.

Acceptance: an agent can distinguish validation, authorization, transient transport, timeout, cancellation, and internal failures without parsing prose.

Acceptance evidence (2026-07-11): `lib/tool-result.ts` now exports `FailureDetails` with optional `code`, `retryable`, `action`, `schemaVersion`, `truncated`, and `correlationId`; `fail()` keeps backward compatibility via `Record<string, unknown>`. ADR 033 documents the schema. Adoption started at the agent-spawning and CoAS schedule boundaries. Tests in `tests/lib/tool-result.test.ts` verify structured metadata and backward compatibility.

---

## P2.4 — Release and maintenance discipline

- [ ] Add `CHANGELOG.md` with migration and deprecation notes.
- [ ] Add `SECURITY.md` with supported versions and private reporting instructions.
- [ ] Add concise contributing and release instructions.
- [ ] Define version alignment for the root package and extension packages.
- [ ] Add a tag-driven release workflow with provenance and package smoke verification.
- [ ] Document the support window for Node, pi, homeserver Matrix versions, and public tool contracts.

Acceptance: a release is reproducible, auditable, upgradeable, and reversible.

---

## Explicit non-goals

- No generic retry/circuit-breaker framework without a demonstrated repeated-failure consumer.
- No generic workflow/DAG engine.
- No durable metrics service or event bus.
- No Matrix message spill database in the first reliability slice.
- No broad coverage target that rewards superficial tests.
- No full `matrix-bot-sdk` fork unless the migration spike fails its documented acceptance criteria.

## Recommended execution order

1. Fix the deterministic test gate.
2. Complete Matrix characterization tests and migration spike.
3. Migrate Matrix, remove the vulnerable dependency chain, and verify restart behavior.
4. Add Matrix overflow visibility and ingress limits.
5. Harden CI and compatibility evidence.
6. Make doctor inventory authoritative.
7. Generate discovery metadata and documentation.
8. Add behavioral evaluation and structured result improvements incrementally.
9. Establish the release workflow and publish only after the P0/P1 gates pass.
