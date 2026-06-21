# Current Session State

## Metadata
- **Project:** pi-tools-and-skills
- **Role:** General Manager (GM)
- **Status:** Implementing ADR 029 (Phase 1)
- **Date:** 2026-06-21

## Recent Accomplishments
- **Removed `router-fusion`:** Built-in team and legacy `fusion` protocol fully removed from the codebase and user-scope.
- **Implemented `/team on` Determinism:** `/team on` now deterministically runs the configured team for every prompt.
- **Implemented `/team auto`:** Added a new mode for assistant-mediated team runs (the old `on` behavior).
- **Implemented `/team once <prompt>`:** Added support for deterministic inline team runs with a single command.
- **Implemented `/teams prune`:** Added a command to remove stale user-scope team files projected from deleted built-in seeds.
- **Patched AGENTS.md:** Clarified the General Manager role (coordinate/review/integrate) and delegation rules.
- **Config Synchronization:** Updated local `.pi/settings.json` to replace `routerFusion` defaults with `fusionAnalysis`. Gravitas/Quartermaster coordinating EO cleanup.

## Active Task
- **Strengthening `/team on` with Context (ADR 029):**
    - Implemented `buildTeamContext` in `team-session-mode.ts` to gather and bound session history (last 5 turns, 4k char limit, heuristic secret redaction).
    - Injected this context into `forcedRunParams` so deterministic team runs (`on` and `once`) are no longer "blind" to the conversation.
    - Verified implementation with 5 new unit tests in `tests/teams/team-session-mode.test.ts`.

## Validation Results (latest run)
- `npm run check`: PASS (typecheck, lint, knip, type-coverage 99.32%).
- `npx vitest run tests/teams`: 218 tests passed.
- No new findings from knip.

## Delivery
- Committed and pushed to `origin/main` at `41765e3` (merge of `feat/adr-029-team-context`).

## Next Steps
- Consider Phase 2 (Main-Agent-First Review mode) if Phase 1 proves insufficient in practice.

## Known Issues
- **Pre-existing test failure:** `tests/architecture/lib-layering.ts` flags `lib/session-spool-select-cli.ts` as unclassified (introduced in `f711b3f`). This is unrelated to the team work.
