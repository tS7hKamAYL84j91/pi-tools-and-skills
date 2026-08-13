# Specification — Monorepo Extension Refactor and FIRE Review

## Goals

- Inventory and analyse every TypeScript extension under `extensions/` plus directly coupled shared `lib/` modules.
- Establish risk using architecture fitness, code size/complexity, churn, temporal coupling, ownership, dead-code, dependency, side-effect, persistence, subprocess, network, and public tool/command evidence.
- Perform an evidence-backed Dan Ward FIRE review across all extensions.
- Refactor verified release blockers and high-risk maintainability defects while preserving external behaviour.
- Remove demonstrated dead code and speculative abstractions; simplify side-effect boundaries where tests can preserve behaviour.
- Update Mermaid architecture documentation for material boundary changes.
- Finish with independent review and complete quality-gate evidence.

## Non-goals

- Feature development unrelated to a verified defect.
- Cosmetic rewrites, wholesale style churn, speculative frameworks, dependency additions, or public API redesign without a separate ADR.
- Fitness-test exemptions or raised budgets used to hide complexity.
- Changes to `working-notes/`, ignored runtime state, credentials, raw sessions, `.workers/`, or other repositories.
- Fixing every P2/P3 observation when the change would add more risk than value; bounded follow-ups are acceptable when explicitly reported.

## Constraints

- Preserve public tools, commands, persistence formats, and runtime behaviour unless a failing test or accepted ADR requires correction.
- Characterisation tests precede behaviour-sensitive refactors.
- Work in the isolated `/tmp/pi-adr043-refactor` worktree; do not overwrite the user's untracked main-tree files.
- Keep WIP bounded: at most three parallel audit streams; implementation remains sequential per extension slice.
- No dependency additions. Native Node APIs and existing shared helpers first.
- Google TypeScript style, strict typing, minimum 95% type coverage, clean Biome, Knip, and architecture fitness.
- Stop and fix on every failed milestone validation.

## Done when

- All nine extension directories have a recorded evidence matrix and FIRE disposition.
- The current ADR-043 external-agent blocker is corrected and independently reviewed.
- Every verified P0/P1 finding in scope is fixed or explicitly escalated to the named owner/authority.
- Demonstrated dead files/exports/dependencies are removed; Knip reports zero findings.
- `docs/architecture.md` and a durable FIRE report describe the final extension boundaries.
- `npm run check`, `npm test`, architecture tests, `git diff --check`, and a bounded secret scan pass.
- Navigator and llm-council final reviews return no unresolved blocker.
