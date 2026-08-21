# Architecture Refactor Queue Goal

## Goal

Complete the remaining verifiable work in `planning/ARCHITECTURE-REFACTOR-QUEUE.md` without weakening architecture fitness tests or changing pi-boost / declarative-discovery boundaries.

## Completed evidence

- [x] Tracks 1.1–1.4: hotspot decompositions merged.
- [x] Tracks 2.1–2.3: deterministic TUI view-model/snapshot tests and command harnesses merged.
- [x] Track 4: CoAS/Panopticon single-tenant helpers and CLI entrypoints relocated; layering fitness strengthened.
- [x] Track 5.1 and Kanban migration: `lib/event-log.ts` added and Kanban transaction persistence migrated.
- [x] Integration checks before the current goal plan: `npm run check` passed at 99.24% type coverage; `npm test` passed 176 files / 1,380 tests.

## Remaining work

- [x] (5.2) Assessed Teams run-state persistence: migration is not warranted. Teams persists its protocol-neutral events through the host session custom-entry WAL (`pi.appendEntry`) and rehydrates from the current session branch; adding `lib/event-log.ts` would duplicate storage and break session-branch recovery semantics. Existing event format is preserved. Validated with the Teams and event-log suites.
- [x] (2 coverage) `npm run test:coverage` passed (176 files / 1,380 tests) and supplied module coverage: all files 72.14% statements; `pi-panopticon/ui` 71.77%; extracted view-models meet the intended deterministic-test scope (`agent-detail-model.ts`, `status-view-model.ts`, and Kanban `overlay-model.ts` at 100%; `goal-render.ts` at 96.66%). The aggregate UI shell remains below the historical 75% aspirational target, so no threshold is claimed or relaxed; further interactive-shell coverage is separate follow-up work.
- [x] (delivery) Updated `planning/ARCHITECTURE-REFACTOR-QUEUE.md` to reflect merged tracks, Teams' session-WAL decision, coverage evidence, and follow-up coverage scope.
- [x] (release) `git diff --check`, `npm run check`, and `npm test` passed; integrated queue documentation is committed and pushed.

## Follow-up (out of scope for this goal)

- [ ] Fix `/goal` bounded-run continuation: advancing a milestone currently sets `runActive: false`, ending the loop instead of automatically delivering the next bounded invocation. Add regression coverage in the pi-goal suite.

## Constraints

- No architecture-fitness exemptions, threshold relaxations, or exception-list additions.
- `extensions/pi-boost/**`, `extensions/pi-panopticon/teams/team-paths.ts`, and `lib/declarative-discovery.ts` are out of scope.
- Do not add a generic persistence framework beyond the concrete Teams need.
