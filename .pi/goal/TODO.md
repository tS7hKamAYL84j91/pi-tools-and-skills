# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

Complete the work described by planning/TEAMS-FIRST-TODO.md

# TODO: Extract pi-teams Before Protocol SPI

## Objective
Extract Teams and swarm compatibility from `pi-panopticon` into an independently installable `extensions/pi-teams` package. Defer the generic protocol SPI.

## Tasks
- [x] Map direct Panopticon/Teams imports and preserve only explicit public runtime services.
- [x] Move `teams/` and `swarm/` into `extensions/pi-teams/` with its own entrypoint and package manifest.
- [x] Keep the direct bounded `TEAM_HANDLERS` registry; do not add `TeamTopologyRegistry` or `lib/team-protocol-spi.ts`.
- [x] Make pi-binary resolution Teams-owned; keep Panopticon spawner private.
- [x] Remove Panopticon-owned Teams/swarm registration and update installation/setup wiring.
- [x] Preserve `team_*`, `runtime_status`, `runtime_stop`, and swarm compatibility behavior.
- [x] Update Mermaid C4 architecture, package documentation, and ADR-048 for the public extension boundary.
- [x] Run `npm run check` and `npm test`; review before merging.

**🔴 AUTONOMY RULE — READ FIRST:**
The implementation agent is expected to complete outstanding items without asking the user for confirmation.

- Pick work from this TODO, implement it, validate it, and update this file.
- Use the smallest useful change.
- Preserve useful content; do not delete source material unless it is clearly duplicate, empty, generated junk, or moved with an auditable note.
- Prefer moves/renames over rewrites.
- Escalate architecture, security, broad policy decisions, or destructive cleanup to `llm-council` when available.
- Use `navigator` review when substantial repo changes are made and team tools are available.

Progress markers:
- `[ ]` Planned
- `[~]` In progress
- `[R]` Ready for review
- `[x]` Done
- `[!]` Blocked

---

## How to use this TODO

1. Claim an item — change `[ ]` to `[~]` and add a dated note with intended scope.
2. Implement the smallest useful change.
3. Refactor only as needed to keep the result simple.
4. Validate with project checks or a documented manual check.
5. Update docs/architecture notes when the project requires it.
6. Change to `[R]` when ready for review, then `[x]` after validation/review.
7. If blocked, change to `[!]`, record the blocker and next decision needed, then stop broadening scope.

## Remaining TODO Items

- [x] (1.1) Map the Teams/Swarm dependency boundary: enumerate direct Panopticon imports, decide the Teams-owned pi-binary helper, and define the public runtime surface.
  - Evidence: `planning/TEAMS-FIRST-BOUNDARY.md`; the only private import is `teams/runner.ts` → Panopticon `resolvePiBinary()`.
  - Validate: `rg -n 'teams/|swarm/' extensions/pi-panopticon tests` (PASS, 2026-08-21)
- [x] (1.2) Extract `teams/` and `swarm/` into an independently installable `extensions/pi-teams` package; retain static bounded handlers and move Teams registration there.
  - Implemented by local Luna agent `teams-extractor-luna` in `/tmp/pi-teams-first`; Jules session `12725193013193451918` was not used or pulled.
  - Evidence: independent GM rerun passed 47 files / 303 tests; read-only peer audit found no SPI/Boost scope leakage or Panopticon Teams imports.
  - Validate: focused Teams, Swarm, and extension-registration tests (PASS, 2026-08-21).
- [x] (1.3) Remove Panopticon's private Teams/Swarm ownership; update package setup, Mermaid architecture, extension documentation, and ADR-048 for the public extension boundary.
  - Implemented by local Luna agent `teams-extractor-luna`; next sequential ADR slot confirmed and used as `docs/adr/048-standalone-pi-teams-public-boundary.md`.
  - Evidence: setup wiring tests 7/7; root and independent architecture validation 64/64; `git diff --check` passed; peer re-audit found no ownership inconsistency.
  - Validate: architecture fitness and documentation checks (PASS, 2026-08-21).
- [x] (1.4) Run `npm run check` and `npm test`; review the integration branch and record final evidence.
  - Final evidence: `npm run check` PASS (99.24% type coverage); `npm test` PASS (176 files / 1,384 tests); architecture/registration 64/64; setup wiring 7/7; independent review DONE; bounded gitleaks scans found no leaks.
  - Delivery: extraction commit `93c83ce`, planning commit `bcc917f`, merge commit `5891bb9`; pushed to `origin/main`.
  - Unchanged/deferred: direct `TEAM_HANDLERS` retained; SPI isolated on `defer/team-protocol-spi`; Boost/TTL/T-850 untouched; pi-goal anti-stall remains a separate ADR-backed follow-up.

---

## Completion Criteria

- All TODO items are `[x]`, `[R]` with review notes, or `[!]` with explicit blockers.
- Required validation has passed or has a documented reason why it cannot run.
- Final state and evidence are recorded in this file.
