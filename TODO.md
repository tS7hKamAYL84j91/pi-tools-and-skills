# TODO — Repo Improvements (from 2026-09-01 GM review)

**Status:** review items landed 2026-09-01 via pi-goal `g-c59d1288` (epic T-875, milestones M1–M6). Remaining work is tracked in kanban (T-880, T-881) or blocked on the in-flight boost stream. The dirty boost tree is owned by the boost stream (T-843/T-844) — do not touch it.

## P0 — In-flight boost work (uncommitted; boost-stream owned — DO NOT touch the dirty tree)

- [ ] 3 failing tests in the dirty tree before it lands: `tests/boost/pi-boost-settings.test.ts` (`agentSelfBoost.enabled`), `tests/boost/pi-boost-cognitive.test.ts` (settings expectations), and the console.log fitness violation in untracked `tests/boost/boost-workspace-smoke.test.ts`.
- [ ] 3 over-budget boost files in the dirty tree (line-count fitness): `boost/cognitive-lease.ts` 310/300, `boost/command.ts` 330/300, `boost-settings.ts` 317/300 — split or add a justified hotspot budget at landing (see T-880 note).

## P1 — Structural

- [x] **Daemon packaging risk — DONE via ADR-053** (`af6a9e4`): `lib/daemon-protocol/` extracted; pi-panopticon decoupled from the private daemon; architecture guard test; CI green.
- [x] **CI duplication — DONE** (PR #52, `90306ef`): fitness.yml scoped to `vitest run tests/architecture tests/shared`.
- [x] **CI pin inconsistency — DONE** (PR #52): checkout commit-SHA-pinned in both workflows.
- [x] **Install-smoke matrix — DONE** (PR #52): all 11 extension packages + root covered.
- [ ] **Fix pi-matrix issue** captured in `docs/images/Screenshot 2026-09-01 at 19.49.01.png` (Principal-reported 2026-09-01 19:49) — tracked as kanban **T-881**.

## P2 — Dead code (verified: zero production importers)

- [x] `extensions/pi-kanban/lifecycle.ts` — deleted with its 2 tests per ADR-054 (reclassified test-only; `b0ca375`).
- [x] `extensions/pi-teams/worktree-isolation.ts` — deleted with its test (`fc2d74e`); pi-teams child-process boundary now zero.
- [x] `extensions/pi-panopticon/ui/memory-renderer.ts` + `ui/memory-writer.ts` — deleted with tests + fixtures (`fc2d74e`); ADR-022 disposition note appended.
- [ ] `extensions/pi-boost/boost/cognitive.ts` shim — deferred: in-flight boost area; disposition lands with **T-880**.
- [x] **Test-only-import fitness rule — implemented** (red→green evidence; branch `goal/t876b-test-only-disposition`) but **landing deferred → T-880**: it flags 6 further test-only modules (3 pi-boost mid-integration by the boost bridge, 3 pi-teams pending supersession verification); no-exemptions directive forbids landing with carve-outs.
- [x] Orphan scripts deleted (PR #53, `a35a6e0`): `scripts/t851-artifact-smoke.sh`, `scripts/session-spool-hook.mjs`. **Correction:** `scripts/pi-package-settings.py` is live (invoked by `scripts/setup-pi`/`setup-pi-clean`) and retained.
- [x] `extensions/pi-ollama-models/` verified intentional in this repo (T-724 promotion; T-762's removal referred to pi-extension-poc); covered by install-smoke.

## P3 — Hygiene

- [x] ADR numbering — index created (PR #54): 024/033 collisions and 020/028 gaps documented; next slots 053/054 used by this work.
- [x] Lint — the 2 non-null assertions and 2 template-literal infos in tests/daemon fixed (PR #54, `0706639`).
- [x] Lint/knip scope — biome lint covers `scripts/` (574→586 files) and knip entry covers `scripts/*.mjs` (`0a93ed8`).
- [x] Release — **1.2.0 cut** per RELEASING.md: CHANGELOG dated, versions aligned across root + extension packages, SECURITY.md table already 1.2.0-ready.
- [x] README — pi link verified, Python-3 prerequisite clarified, package.json description/author filled (PR #54).
- [x] Review graph — refresh triggered; complexity hotspots to watch: `lib/session-log.ts` (29), `pi-teams/team-registry.ts` (26), `team-node-runner.ts` (26), `boost-descriptor.ts` (24).
- [x] CI-failure check — main green through 1.2.0; the Aug-28 alternating-failure flake family was resolved by the de-flake commit; one intermediate date-assertion flake in `t873-step1-execution.test.ts` noted at `af6a9e4` (passed in the containing run).

## Remaining, tracked elsewhere

- **T-880** (kanban, blocked on boost stream): land the no-exemptions fitness rule + dispose the 6 remaining test-only modules; boost stream must also clear its 3 over-budget files and the console.log violation.
- **T-881** (kanban): pi-matrix fix per Principal screenshot.
- **P0 above**: boost stream's dirty tree (T-843/T-844).
