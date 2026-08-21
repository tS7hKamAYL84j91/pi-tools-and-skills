# ADR 026: Project Built-in Teams into `~/.pi/agent/teams` as the User Source of Truth

Status: Accepted
Date: 2026-06-20
Source: historical `docs/team-builtin-projection-plan.md` in git history; llm-council panel review (run `team-mqm4dr9m-e8168bf0`, 4/5 members reported) + Navigator review.

## Context

Built-in team specs ship at `extensions/pi-teams/config/teams/*.md`
with hard-pinned `model:` ids per agent binding. Two problems drove this ADR:

1. **Wrong layer for user preference.** An EO routing decision was applied by
   editing the shipped built-in files directly. `team_form`/`team_delete`
   deliberately route customisation to user (`~/.pi/agent/teams`) or project
   (`.pi/teams`) scope and refuse to delete built-ins. Editing built-ins
   bypasses that layering, breaks `tests/teams/team-config.test.ts`
   (test-locked default ids), and mutates defaults for all consumers.

2. **Models unknown at ship time.** Pinned ids may not exist on the user's
   Ollama. The auto path (`team-handler-*.ts`) uses pinned models as-is; only
   the interactive picker (`chooseTeamMemberModels`) adapts to the registry.

The owner directed: built-in teams should be changeable; on extension install
they MUST be projected into `~/.pi/agent/teams`; that live copy is the source
of truth for an implemented user preference — not the extension; respect
preexisting config on start/reload; models are not known prior to install.

A confirmed latent bug shaped the decision: `settings.ts` `resolveTeamSettings`
uses `lastDefined(...)` across builtin→user→project, so projecting a
**stripped** (empty-model) `llm-council`/`navigator` into user scope would
empty global `defaultMembers`/`defaultSynthesis`/`defaultConsult` and break
debate/research/consult loudly. Naive strip-and-project is unsafe.

## Decision

**Project built-in team files verbatim into `~/.pi/agent/teams/teams/` on
`session_start` (`reason === "startup"`, optionally `reload`). Projection is
idempotent and never overwrites an existing user/project file. No `model:`
stripping. No `settings.ts` change. No auto-path handler selection-logic
change. Unavailable pinned models fail loudly and actionably.**

### Policy

1. **Live user-scope file is the source of truth for that team.** A built-in
   team id that has a user-scope (or project-scope) file resolves from that
   file; otherwise it resolves from the builtin seed. Runtime already
   prefers user > builtin (`loadTeamRegistry` later-source-wins), so no
   resolution-order change is required.

2. **Built-in seeds are immutable packaged defaults.** `config/teams/*.md`
   stay test-locked and `team_delete` still refuses built-in ids. They are
   projection sources, not the runtime authority once a live copy exists.

3. **Projection is idempotent, additive, and non-destructive.** Built-ins are
   copied to the user scope only when the target file is missing. Existing
   user/project files are never overwritten. Destination uses
   `dirsForTeamScope("user", cwd)` so configured `teams.roots` overrides are
   honoured.

4. **No silent model substitution on the auto path.** A pinned model that is
   unavailable causes a loud, actionable error (which model, which file, what
   is available). Substitution is only permitted in explicit opt-in flows
   (the interactive `/teams models` picker). This matches the existing
   `team-handler-fusion.ts` filter-then-loud-fail pattern; `padFromSnapshot`
   substitution in the auto path is explicitly rejected (council degeneration,
   heterogeneity erosion, trust destruction).

5. **Defaults remain `lastDefined` across sources in v1.** The current
   "edit one live `llm-council.md`, all teams benefit" behaviour is
   pragmatically useful when shipped models are unavailable. Because
   projection is verbatim, the user-scope copy carries the same pinned ids as
   the seed, so global defaults are stable and the latent bug does not
   trigger.

6. **Trigger is `session_start(startup)` ONLY (closest available hook to
   "on install"; pi has no install/enable event).** NOT on
   `reload | new | resume | fork`. `startup`-only (not `reload`) honours the
   owner's "respect preexisting config on start/reload" direction: a user who
   deliberately deleted a projected file must not have it silently restored on
   reload. The upgrade case (new built-ins shipped) is handled by `/teams seed`
   (and/or a marker-file version bump).

## Consequences

- **Positive:** Global defaults are stable; the latent empty-defaults bug
  cannot recur; live files are real, editable configs with a concrete
  starting point; first-run behaviour is predictable; v1 is small and
  reversible; `team-config.test.ts` is unchanged (shipped seeds stay
  test-locked).
- **Negative:** Users whose registry lacks the pinned seed models get a loud
  error on first `team_run` and must edit the live file (or run
  `/teams models`). This is intentional — transparency over silent
  degradation.
- **Known v1 residual risk (loud, not silent):** because v1 preserves
  `lastDefined`, a user who strips ALL `model:` lines from their live
  `llm-council.md`/`navigator.md` re-triggers the empty-defaults bug (debate/
  research/consult fail loudly). Verbatim projection itself never causes this;
  only a deliberate all-models-stripped edit does. Durable immunization is the
  v2 seed-only-defaults ADR. Documented, not silently ignored.
- **Deferred to v1.1:** Pre-flight model-availability check in the shared
  handler path → actionable errors listing unavailable pinned ids, the file
  path, and available models (extends fusion's filter-then-loud-fail pattern
  to debate/research/consult).
- **Deferred to v2 (separate ADR):** "Defaults are packaged, not
  user-derived" — make `resolveTeamSettings` defaults seed-only. Adopt with
  usage evidence, not bundled with projection. Also: `respectAbsent`
  projection policy (track user deletion via a sidecar so projection does
  not restore a file the user deliberately removed).

## Data side-fix

The shipped `llm-council.md` pins `model: "ollama/kimi-k2.6:cloud "` with a
trailing space inside the quotes. Fix at source in a separate trivial change
so projection copies clean ids.

## Alternatives considered

- **Option 1 — strip models + seed-only defaults.** Rejected for v1: creates a
  hollow source of truth (empty `model:` slots are not an "implemented
  preference"); requires a `settings.ts` contract change bundled with
  projection; the strip variant triggers the latent empty-defaults bug unless
  paired with that contract change.
- **Option 2 — verbatim + registry-aware auto path (silent substitution).**
  Rejected: silent substitution can collapse a multi-provider council to a
  single family with no error, defeating heterogeneity; introduces a pattern
  the codebase already chose against (fusion filters-and-fails, does not
  substitute); touches 3-4 handlers (broad regression surface).
- **Option 3 (chosen) — verbatim + loud failure.** Smallest reversible v1;
  avoids the latent bug with no settings/handler change; honest, actionable
  failure; consistent with the existing fusion-handler pattern.