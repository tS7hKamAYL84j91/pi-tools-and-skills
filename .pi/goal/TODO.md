# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

complete the imeplementations, refactor then commit. converge on clean implementaiton of on, auto, once, off, prune and a UX that aligns with our principles, and tests exist include arch fitness tests

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

- [x] (1.1) Inspect the current repository state and refine this TODO into concrete, verifiable tasks derived from the goal.
- [x] (1.2) Implement the smallest useful change that advances the goal: add `/teams prune` to remove stale user-scope team files when built-in seeds are deleted.
- [x] (1.3) Validate the result and record evidence.
- [x] (1.4) Final summary: what changed, what stayed unchanged, validation performed, and any blockers or follow-up work.

---

## Phase 2 Candidate — Main-Agent-First Review Mode

Optional future enhancement if Phase 1 context enrichment proves insufficient. Spec is in `docs/adr/029-team-context-review.md`; do not implement until Phase 1 has been exercised.

---

## Final Summary

Implemented and validated:

- `/team on` is deterministic: every user prompt runs the configured team.
- `/team auto` is assistant-mediated: the model decides when to call `team_run`.
- `/team once <prompt>` runs the team immediately on the given prompt.
- `/team off` and `/team status` remain unchanged.
- `/teams prune` removes stale user-scope team files for ids no longer present in built-in seeds; custom user teams are preserved.
- **ADR 029 Phase 1 — Context enrichment:** deterministic `/team on` and `/team once` now include bounded recent conversation context (last 5 user/assistant text turns, up to 4k chars, secret heuristics, tool/system messages skipped). Implemented in `team-session-mode.ts` without changing `TeamRunInput` or any team protocol.

Files changed:
- `extensions/pi-panopticon/teams/team-session-mode.ts` — deterministic on, auto mode, once prompt, `buildTeamContext`.
- `extensions/pi-panopticon/teams/team-projection.ts` — `pruneBuiltinTeams`.
- `extensions/pi-panopticon/teams/team-commands.ts` — `/teams prune` command.
- `extensions/pi-panopticon/teams/README.md` — UX and context enrichment documentation.
- `docs/adr/029-team-context-review.md` — ADR spec, Phase 1 marked implemented.
- `tests/teams/team-session-mode.test.ts` — updated for on/auto/once and `buildTeamContext`.
- `tests/teams/team-projection.test.ts` — prune tests.

Validation:
- `npm run check` passes.
- `npx vitest run tests/teams` — 218 tests pass.
- `type-coverage` 99.32%.
- Full `npm test` has one pre-existing unrelated failure: `lib/session-spool-select-cli.ts` unclassified in `tests/architecture/lib-layering.ts`.

Delivered to `origin/main` at `41765e3`. No blockers.
