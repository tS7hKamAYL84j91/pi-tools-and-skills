# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

implemente using sub agents you are architect the design lead the planning/PLAN.md

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

- [x] (1.1) Inspect repository state and refine the goal. 2026-07-12: reviewed `planning/PLAN.md`, team handlers/runtime/TUI, active tests, and clean baseline `c562ead` (aside from planning/goal files).
- [x] (2.1) Implement the shared `fast | balanced | thorough` team profile contract with explicit precedence and compatibility for existing Fusion `limits.maxLoops` callers. Evidence: `f3f1cd5`, ADR 034, profile/session/tool tests.
- [x] (2.2) Implement Fusion critical-path improvements: concise/bounded panel output, provider-mapped generation caps, bounded judge input, complete judge schema including final `answer`, provider diversity, degraded fallback, and direct displayed results without an extra LLM turn. Evidence: `f3f1cd5`, `db660cb`, `1e4ca6b`.
- [x] (2.3) Implement Navigator fast behavior: compact output contract, bounded generation/retries/timeout, and minimal context in Fast mode while preserving bounded context for other profiles. Evidence: `tests/teams/team-consult-profile.test.ts`.
- [x] (3.1) Implement compact all-node progress, event-driven refresh, run-specific widget ownership, and no-ID cancellation of the newest active run. Evidence: `a2a5348`, `1e4ca6b` and state/progress/command tests.
- [x] (3.2) Remove registry/filesystem reads from team-browser render paths and add focused one-shot Run/Profile controls using native TUI components. Evidence: `3d9a8c5`, `d50b120` and render-path fitness tests.
- [x] (4.1) Add deterministic tests for profiles, Fusion/Navigator behavior, progress, cancellation, provider payloads, and render-path boundaries. Evidence: final full suite passed 116 files/937 tests, including architecture fitness.
- [x] (4.2) Add bounded deterministic evaluation fixtures and an opt-in redacted live latency/quality harness. Live measurements were intentionally not run; Balanced remains default until the documented gates pass. Evidence: `2de8fd9`, `tests/evals/team-speed-profile-evaluation.md`.
- [x] (5.1) Update team docs, architecture Mermaid, planning/progress/knowledge files, ADR 034, and evaluation methodology.
- [x] (5.2) Run validation and reviews. Final integrated evidence: `npm run check` passed at 99.19% type coverage; `npm test` passed 116 files/937 tests; `npm run test:evals` passed 3 files/13 tests; benchmark syntax/opt-in guard passed. Navigator initial REVISE findings were fixed and re-review returned PASS; final council returned PASS and follow-ups were applied.
- [x] (6.1) Completion audit and final evidence recorded. All implementation requirements are done; live provider measurement, generic reasoning-effort normalization, metadata/render caching are explicitly deferred with safety/KISS rationale and do not change the Balanced default.

---

## Completion Criteria

- All TODO items are `[x]`, `[R]` with review notes, or `[!]` with explicit blockers.
- Required validation has passed or has a documented reason why it cannot run.
- Final state and evidence are recorded in this file.
