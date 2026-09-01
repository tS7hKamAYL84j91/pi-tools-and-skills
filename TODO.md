# TODO — Next Cycle (from the 2026-09-01 final architecture & health review)

**Context:** the 2026-09-01 GM review (pi-goal `g-c59d1288`, epic T-875) is complete — 17 commits, v1.2.0 released, all gates green at `96a8204` (200 test files / 1,517 tests, knip clean, type-coverage 99.28%, CI double-green). This file is the forward backlog from the closing review. Board tickets: T-880, T-881.

## P1 — Immediate

- [x] **Pin `actions/setup-node` in `fitness.yml:18`** to the same commit SHA used in `ci.yml` (`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`) — fixed in the T-880 landing.
- [x] **T-880 — land the ADR-054 no-exemptions fitness rule + dispose test-only modules.** Rule now passes with zero violations; the full superseded boost authority/control cluster and pi-teams test-only modules were deleted, while the reviewed host bridge is exported from the package entry. P1 pin included in the landing (`6fa9a58`, `badd421`).
- [x] **T-881 — fix the pi-matrix issue** captured in `docs/images/Screenshot 2026-09-01 at 19.49.01.png`: legacy matrix-js-sdk `logger.log()` calls now stay silent; regression test added in `extensions/pi-matrix/tests/sdk-logger.test.ts` (`e95ef01`).

## P2 — Debt register (from the full lens scan; not gate failures)

- [x] **Adopt-or-accept decision on boundary decoding:** accept the existing typeof/narrowing style for now; the P2 security-sensitive dynamic-regex and escaping sites were hardened without introducing a new global lint gate. Revisit incrementally if the style becomes a correctness risk.
- [x] **Triage the 13 lens-blocking rule hits:** named JSON/domain types, explicit error handling, and the required SAFETY comment were added across the listed files (`f5eabdc`).
- [x] **DRY extraction candidates:** the highest-value scheduler run-state duplication was extracted into `extensions/pi-coas/lib/coas-run-state.ts` (`f5eabdc`); remaining low-risk pairs stay documented for later review.
- [x] **Complexity watch list recorded:** `lib/agent-registry.ts`, `pi-teams/team-registry.ts`, `pi-boost/boost-descriptor.ts`, `pi-teams/team-node-runner.ts`, `lib/session-log.ts`, and `pi-coas/scheduler-run-state.ts` are tracked for split-before-growth; current architecture fitness is green.
- [x] **Security hardening:** dynamic section/member matching now uses literal scans (no user-derived RegExp), prompt XML escaping is single-pass, and the listed P2 security sites are covered by the passing gate (`f5eabdc`).

## P3 — Recorded false positives (no action; re-verify only if tooling changes)

- [x] `package.json:33` gitleaks "generic-api-key" = the author's GitHub username; the repo's own policy (`.gitleaks.toml`) passes green in CI.
- [x] lens-knip "unused file `boost/command-types.ts`" — it is imported by `boost/command.ts:29-30`; the repo's `npm run knip` gate is clean.

## Done in the prior cycle (record)

- 2026-09-01: review goal `g-c59d1288` complete — ADR-053 daemon-protocol extraction (published boundary enforced by architecture guard + tarball proof); ADR-054 disposition (4 test-only modules + tests/fixtures deleted, pi-teams child-process boundary zero); CI hygiene via Jules PRs #52/#53/#54; lint+knip scope extended to `scripts/`; ADR index created; **1.2.0 released** (all 13 package versions aligned); the in-flight boost stream completed and landed (ADR-052 single-model default, line-budget module splits, live smoke test removed); the recurring `t873-step1-execution` date-assertion flake root-cause fixed. See `CHANGELOG.md` [1.2.0] and `docs/adr/README.md`.
