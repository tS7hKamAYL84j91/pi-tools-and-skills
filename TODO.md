# TODO — Repo Improvements (from 2026-09-01 GM review)

**Status:** review items landed 2026-09-01 via pi-goal `g-c59d1288` (epic T-875, milestones M1–M6). Remaining work is tracked in kanban (T-880, T-881). The boost stream's dirty tree was completed and landed 2026-09-01 per Principal directive.

## P0 — Boost stream — RESOLVED 2026-09-01 (dirty tree completed and landed per Principal directive)

- [x] Test failures resolved: settings/cognitive tests pass with the completed ADR-052 work; the one-off live smoke test (untracked `tests/boost/boost-workspace-smoke.test.ts` — console.log + live model call + repo-local settings assumption) deleted.
- [x] The 3 over-budget files split under the line budget: `cognitive-lease.ts` → + `cognitive-lease-single.ts` + `cognitive-lease-fusion.ts`; `boost-settings.ts` → + `boost-settings-parse.ts`; `command.ts` → + `command-types.ts`. Full suite green (200 files / 1517 tests).

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

- **T-880** (kanban): land the no-exemptions fitness rule + dispose the remaining test-only modules — boost-stream blocker RESOLVED (stream landed); re-run the rule for the current flagged list and disposition.
- **T-881** (kanban): pi-matrix fix per Principal screenshot.
- **P0 above**: resolved — boost dirty tree completed and landed.
