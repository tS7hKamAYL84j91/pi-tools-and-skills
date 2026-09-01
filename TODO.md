# TODO — Next Cycle (from the 2026-09-01 final architecture & health review)

**Context:** the 2026-09-01 GM review (pi-goal `g-c59d1288`, epic T-875) is complete — 17 commits, v1.2.0 released, all gates green at `96a8204` (200 test files / 1,517 tests, knip clean, type-coverage 99.28%, CI double-green). This file is the forward backlog from the closing review. Board tickets: T-880, T-881.

## P1 — Immediate

- [ ] **Pin `actions/setup-node` in `fitness.yml:18`** to the same commit SHA used in `ci.yml` (`actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0`) — the last remaining mutable action reference (opengrep CWE-1357). One line.
- [ ] **T-880 — land the ADR-054 no-exemptions fitness rule + dispose the 6 remaining test-only modules.** The rule is implemented with red→green evidence on branch `goal/t876b-test-only-disposition` (commit `bd82e01`). Modules to disposition: pi-boost `boost/cognitive.ts`, `boost/inert-runtime.ts`, `production-boost-host.ts` (dispositionable now — the boost stream landed in `5f66fe6`), and pi-teams `approval-gates.ts`, `checkpoint-readiness.ts`, `observability.ts` (verify supersession by the current team-node-runner implementation, then delete module + tests). Note: `production-boost-host.ts` ↔ `live-boost-bridge-contract.ts` share 21 duplicated lines — disposition those together.
- [ ] **T-881 — fix the pi-matrix issue** captured in `docs/images/Screenshot 2026-09-01 at 19.49.01.png` (Principal-reported 2026-09-01 19:49). If Matrix behavior changes, run the RELEASING.md item-5 manual homeserver smoke test (invite/join, rich text, attachments, reconnect, restart without replay).

## P2 — Debt register (from the full lens scan; not gate failures)

- [ ] **Adopt-or-accept decision on boundary decoding**: ~350 of the 634 lens warnings are `no-runtime-typeof` / `no-unknown-parameters` idioms — the repo validates with typeof/narrowing instead of decoding at I/O boundaries. Either adopt "decode at boundary" as an incremental lint gate (worst files first) or record the accepted style.
- [ ] **Triage the 13 lens-blocking rule hits**: unknown returns + unchecked-throwing calls in `pi-doctor/doctor.ts`, `daemon/src/record.ts`, `daemon/src/policy.ts`, `pi-goal/goal-persist.ts`, `pi-goal/goal-migration.ts`, `pi-panopticon/registry/external-registrar.ts`, `pi-file-watch/config.ts`, `pi-matrix/resource-bounds.ts`, `pi-coas/commands.ts` (incl. one `as unknown as` without a SAFETY comment).
- [ ] **DRY extraction candidates** (jscpd): `pi-coas/scheduler-run-state.ts` ↔ `pi-coas/lib/coas-run-state.ts` (35 lines), `pi-boost/boost/cognitive-runner.ts` ↔ `pi-teams/runner.ts` (32), `scripts/setup-pi` ↔ `scripts/setup-pi-clean` (26), `pi-panopticon/ui/agent-list.ts` ↔ `pi-teams/team-models.ts` (20), `pi-teams/pi-binary.ts` ↔ `pi-panopticon/spawner/spawn-service.ts` ↔ `cognitive-runner.ts` (10 × 3).
- [ ] **Complexity watch list** (split before next growth): `lib/agent-registry.ts` (fan-in 25 × cx 12), `pi-teams/team-registry.ts` (cx 26), `pi-boost/boost-descriptor.ts` (cx 24), `pi-teams/team-node-runner.ts` (cx 26), `lib/session-log.ts` (cx 29), `pi-coas/scheduler-run-state.ts` (fan-in 8 × cx 17).
- [ ] **Security hardening notes** (opengrep, low urgency): non-literal `RegExp(section)` at `pi-coas/workspace-context.ts:37,42` and `RegExp(members)` at `pi-teams/protocol-prompts.ts:15` (ReDoS-class, tool-param input); `replaceAll`-based escaping at `pi-goal/prompts.ts:32` — consider a real sanitizer.

## P3 — Recorded false positives (no action; re-verify only if tooling changes)

- `package.json:33` gitleaks "generic-api-key" = the author's GitHub username; the repo's own policy (`.gitleaks.toml`) passes green in CI.
- lens-knip "unused file `boost/command-types.ts`" — it is imported by `boost/command.ts:29-30`; the repo's `npm run knip` gate is clean.

## Done in the prior cycle (record)

- 2026-09-01: review goal `g-c59d1288` complete — ADR-053 daemon-protocol extraction (published boundary enforced by architecture guard + tarball proof); ADR-054 disposition (4 test-only modules + tests/fixtures deleted, pi-teams child-process boundary zero); CI hygiene via Jules PRs #52/#53/#54; lint+knip scope extended to `scripts/`; ADR index created; **1.2.0 released** (all 13 package versions aligned); the in-flight boost stream completed and landed (ADR-052 single-model default, line-budget module splits, live smoke test removed); the recurring `t873-step1-execution` date-assertion flake root-cause fixed. See `CHANGELOG.md` [1.2.0] and `docs/adr/README.md`.
