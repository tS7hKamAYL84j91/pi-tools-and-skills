# Plan: Project built-in teams into `~/.pi/agent/teams` on install

Status: DECIDED (Option 3) — Navigator review + llm-council panel
synthesis (4/5 members reported; nemotron cancelled). ADR 022 records the
policy. My earlier Option-1 lean (strip models) was OVERTURNED by the council:
verbatim projection avoids the §7 bug with NO settings.ts change.
Owner: pi-tools-and-skills-general-manager
Related: ADR 022 (to be created after council review)

## 1. Problem

Built-in team specs ship at `extensions/pi-panopticon/teams/config/teams/*.md`
with hard-pinned `model:` ids per agent binding. Two issues:

1. **Wrong layer for user preference.** An EO routing decision was applied by
   editing the shipped built-in files directly. Those files are the package
   distribution; `team_form`/`team_delete` deliberately route customisation to
   user (`~/.pi/agent/teams`) or project (`.pi/teams`) scope and refuse to
   delete built-ins. Editing built-ins in-place bypasses that layering, breaks
   `tests/teams/team-config.test.ts` (test-locked default ids), and mutates
   defaults for all consumers.
2. **Models unknown at ship time.** Pinned ids (e.g. `ollama/qwen3.5:cloud`)
   may not exist on the user's Ollama. The runtime auto path
   (`team-handler-*.ts`) uses `args.team.models.members ?? settings.defaultMembers`
   **as-is** — it does not filter unavailable pinned models. Only the
   interactive picker (`chooseTeamMemberModels`) adapts to the registry. So
   pinned built-ins can fail silently on machines that lack those models.

## 2. Target shape (owner's direction)

> Built-in teams should be changeable. On extension install, built-ins MUST be
> projected into `~/.pi/agent/teams`. That live copy is the source of truth for
> an implemented user preference — NOT the extension itself. Respect
> preexisting config on start/reload. Models are not known prior to install.

- Shipped `config/teams/*` become **immutable seed defaults** (stay test-locked
  as packaged defaults; `team_delete` still refuses them).
- On first start after install/enable, seeds are **projected** into
  `~/.pi/agent/teams/teams/` (user scope). Projection is **idempotent and
  non-overwriting**: a user/project file that already exists for an id is left
  untouched.
- After projection, `~/.pi/agent/teams` is the editable authority. Runtime
  already prefers user > builtin (`loadTeamRegistry` later-source-wins), so no
  resolution-order change is needed.
- Projection must not assume any particular model inventory.

## 3. Design decisions (open → pending review)

### 3.1 Trigger

pi has no `install`/`enable` lifecycle event. Candidates:

- **A) `session_start` with `reason === "startup"`** — first reliable point
  after the extension loads. Also re-run on `reason === "reload"` to pick up
  new seeds added by an upgrade, still non-overwriting.
- **B) Explicit command only** (`/teams seed` or `/goal`-style), plus a one-time
  startup nudge/notify. User stays in control; no implicit writes.
- **C) Hybrid** — project on `session_start(startup)` automatically (idempotent,
  non-overwriting), and expose `/teams seed` to re-project missing seeds on
  demand (e.g. after an upgrade or after deleting a live file).

**Lean: C.** Auto-projection makes "live copy is source of truth" true by
default without requiring user action; the command covers upgrades/repair.
Risk: projecting before the model registry is populated. Mitigation: projection
does not depend on the registry if we choose model option B (§3.2); if C
(§3.2), defer or tolerate an empty registry.

### 3.2 Model handling in projected seeds

- **A) Verbatim** — keep pinned `model:` ids. **Rejected**: runtime auto path
  does not filter unavailable models → failures; contradicts "models unknown
  prior to install".
- **B) Strip per-binding `model:` fields** — projected live copies have empty
  model slots; runtime resolves from `settings.defaultMembers` /
  `chooseTeamMemberModels` against the live registry. Seeds carry protocol +
  role structure only. Heterogeneity (`MIN_PROVIDER_FAMILIES = 2`) is enforced
  at runtime against available models.
- **C) Rewrite `model:` against `ctx.modelRegistry.getAvailable()`** at
  projection time — pick best available per provider family. Opinionated;
  may surprise users; registry may be empty at first startup.

**Lean was B, but Navigator + code audit found a blocking bug (§7):** stripping
models from the projected `llm-council`/`navigator` empties global defaults
because `settings.ts` `lastDefined` picks the user-scope projected file. So B is
NOT safe without a paired `settings.ts` change. Council is debating two options:

- **Option 1 — strip + seed-only defaults**: project with `model:` stripped;
change `settings.ts` so defaults derive from the BUILTIN seed only (not
lastDefined across user/project). Live teams have empty slots → runtime falls
back to seed-derived defaults until the user edits. Risk: defaults still pin
shipped ids that may be unavailable (pre-existing); user edits live file to fix.
- **Option 2 — verbatim + registry-aware auto path**: project verbatim; change
`team-handler-*.ts` to filter pinned models against `ctx.modelRegistry` and pad
from the snapshot. `settings.ts` unchanged (verbatim user copy keeps same ids →
defaults stable). Risk: silent model substitution may surprise; must preserve
heterogeneity; broader handler surface.
- **Option 3 (council ask) — verbatim + loud failure**: project verbatim, no
handler/settings changes; `team_run` fails loudly listing unavailable models;
user edits the live file. Smallest change; worst UX.

### 3.3 Scope of projection

- **v1: teams only.** Project `config/teams/*.md` → `~/.pi/agent/teams/teams/`.
- Subagents (`config/agents/*.md`) and prompts (`config/prompts/*.md`) stay
  shared built-ins for now — they define protocol behaviour, not user
  preference. A live team copy references them by id, which resolves through
  the existing multi-source registry.
- **Follow-up (out of v1):** project agents/prompts too if we want live teams
  fully self-contained/editable. Council input wanted on whether v1 teams-only
  creates a half-editable surface.

### 3.4 Respecting preexisting config

- Never overwrite an existing destination file. Projection is "copy missing
  seeds only".
- Honour configured roots: if user settings override the team root
  (`teams.roots` in `~/.pi/settings.json` or project `.pi/settings.json`),
  project into the configured user root, not the hardcoded default.
  (`dirsForTeamScope("user", cwd)` already encodes this.)
- On `reload`, only add seeds for ids that don't exist yet (handles upgrades
  that ship new built-ins).

### 3.5 Tests / quality gates

- Keep `tests/teams/team-config.test.ts` asserting **shipped built-in** ids
  (seeds stay test-locked packaged defaults).
- Add `tests/teams/team-projection.test.ts`:
  - projects missing seeds into a temp user root on `session_start(startup)`;
  - does NOT overwrite existing user files (preexisting edit preserved);
  - strips `model:` fields in projected copies (if §3.2 = B);
  - idempotent on repeated startup/reload;
  - honours a configured `teams.roots` override;
  - `reload` projects newly-added seeds without touching existing ones.
- `npm run check` (typecheck/lint/knip/type-coverage) and `npm test` must stay
  green. No new dependencies.

## 4. Implementation sketch (after review)

- New module `extensions/pi-panopticon/teams/team-projection.ts`:
  - `projectBuiltinTeams(ctx): Promise<{ projected: string[]; skipped: string[] }>`
  - uses `teamDirectories()` to find built-in team dir and
    `dirsForTeamScope("user", ctx.cwd)` for destination;
  - for each built-in team id absent at destination, copy the file (with
    `model:` stripped per §3.2 B) using the file-mutation-safe pattern;
  - idempotent, non-overwriting, returns a manifest for status/notify.
- Wire in `register.ts`:
  `pi.on("session_start", (event, ctx) => { if (event.reason === "startup" || event.reason === "reload") void projectBuiltinTeams(ctx); })`
  (fire-and-forget; surface a one-time `ctx.ui.notify` on first projection).
- Optional command `/teams seed` to re-project missing seeds on demand.
- No change to `team-registry.ts` resolution order (already user > builtin).

## 5. Acceptance criteria

1. After first `session_start(startup)`, every shipped built-in team id has a
   live copy under the configured user team root, unless a user/project file
   already exists for that id.
2. Existing user/project team files are never modified by projection.
3. Projected live copies carry no hard-pinned `model:` (option B) and run
   successfully against an Ollama instance that lacks the originally-pinned
   models (runtime resolves from available registry).
4. `tests/teams/team-config.test.ts` still passes (shipped seeds unchanged).
5. New projection tests pass; `npm run check` + `npm test` green.
6. Repeated startup/reload is idempotent; upgrading to a version with a new
   built-in projects only the new id.

## 6. Navigator review summary (done)

- Q1 auto-projection on `session_start(startup)` is safe; option B had no
  registry-ready risk BECAUSE fallback used `defaultMembers`. (This assumption
  is invalidated by §7.)
- Q2 option B safe for v1, no paired handler change — **OVERTURNED by §7**.
- Q3 teams-only v1 acceptable; document the half-editable surface.
- Q4 keep `team-config.test.ts` as-is; add projection tests with a temp homedir.
- Q5 reuse `dirsForTeamScope("user", cwd)` so projection target == runtime read
  target; honour `teams.roots`; write temp+rename for crash safety.
- Q6 smallest reversible v1: project on `session_start(startup|reload|new)`,
  strip via frontmatter parse, optional `/teams seed`, no handler/settings
  changes, add tests.

## 7. Confirmed latent bug (blocks naive strip-and-project)

`settings.ts` `resolveTeamSettings` builds `teamDefaults` across builtin→user→
project and uses `lastDefined(...)` (last source wins) for `defaultDebate` /
`defaultConsult`. `readTeamDefault` returns a defined `TeamDefault` whenever the
team file EXISTS, even with empty models. So a projected user-scope
`llm-council` with stripped `model:` fields → `defaultDebate.models.members`
undefined → `defaultMembers = []` → `defaultSynthesis = ""` → and
`defaultConsult` vanishes if `navigator` is stripped. Combined with the team's
own stripped `team.models`, `team-handler-debate` throws "debate teams need at
least one member model" and consult has no navigator. **Naive strip-and-project
breaks global defaults.** Any option that strips models MUST pair with a
`settings.ts` change (defaults from builtin seed, or skip empty-model defaults).

## 9. Decision (Option 3 — verbatim projection + loud actionable failure)

**Chosen: Option 3.** Project built-in team files VERBATIM into
`~/.pi/agent/teams/teams/`. No `model:` stripping. No `settings.ts` change.
No auto-path handler selection-logic change. Rely on loud, actionable failure
when a pinned model is unavailable.

**Why this overturned my earlier Option-1 (strip) lean — council consensus
(3/4 substantive members: glm-5.2, minimax-m3, deepseek-v4-pro; kimi-k2.7-code
agreed on verbatim + no silent substitution, preferred seed-only defaults as
policy but did not block v1):**

1. **Verbatim projection avoids the §7 bug with zero settings.ts change.** The
   projected user-scope file carries the SAME pinned ids as the builtin seed,
   so `resolveTeamSettings`'s `lastDefined` picks stable ids → `defaultMembers`
   etc. are NOT emptied. No contract change, no bundled policy shift.
2. **Strip-models creates a hollow source of truth.** A live file with empty
   `model:` slots is not an "implemented user preference"; it is a template
   that fails until the user fills it, and gives no editing starting point.
   Verbatim gives a concrete example to modify.
3. **No silent substitution (reject Option 2).** Silent `padFromSnapshot`
   substitution can collapse a 4-provider council to a single family, defeating
   heterogeneity with no error. The codebase's ONLY registry-aware handler
   (fusion) already chose filter-then-loud-fail (`filterModels` + `throw
   "fusion teams need at least one usable panel model"`), NOT substitution.
   Option 2 would introduce an inconsistent pattern + touch 3-4 handlers.
4. **Loud failure is the safe, honest, reversible failure mode.** A non-expert
   gets an actionable error (which model, which file, what's available) and
   fixes it once. Silent substitution is trust-destroying and load-bearing
   once shipped.
5. **Keep `lastDefined` for v1.** The current "edit one live `llm-council.md`,
   all teams benefit" behaviour is pragmatically useful when shipped models are
   unavailable. The "defaults are packaged, not user-derived" ADR is deferred
   to v2, to be adopted with usage evidence (council: don't bundle a defaults
   contract change with the projection feature).

**Honours owner direction:**
- "live `~/.pi` copy is source of truth" → verbatim copy, what you see is what
  runs (modulo provider availability).
- "models unknown prior to install" → addressed via loud actionable failure + a
  seed-marker comment nudging the user to edit, NOT by pre-emptying the file.
- "respect preexisting config on start/reload" → projection is idempotent and
  NEVER overwrites an existing user/project file.

**Data-correction side-fix (separate trivial PR):** the shipped
`llm-council.md` pins `model: "ollama/kimi-k2.6:cloud "` with a trailing
space inside the quotes (verified) — fix at source so projection copies clean
ids.

## 10. Final v1 scope (Option 3)

1. New `extensions/pi-panopticon/teams/team-projection.ts` (~60-100 LOC):
   - `projectBuiltinTeams(ctx): { projected: string[]; skipped: string[] }`
   - Source: builtin teams dir (`teamDirectories(configPath)[0].teams`).
   - Destination: `dirsForTeamScope("user", ctx.cwd).teams` (honours
     `teams.roots` overrides — reuses the same helper runtime reads from).
   - For each built-in `*.md` whose destination id does NOT exist: copy
     VERBATIM, prepending a body marker comment
     `# Seed projection of <id> from pi-panopticon built-ins. Edit me; this
     # file is the source of truth for this team. Re-project with /teams seed.`
   - Idempotent; never overwrites; write temp+rename for crash safety.
   - No `model:` stripping. No registry dependency (projection is
     model-agnostic, works before registry is populated).
2. `register.ts`: on `session_start` with `reason === "startup"` ONLY (not
   `reload`/`new`/`resume`/`fork`), run `projectBuiltinTeams(ctx)`
   fire-and-forget; one grouped `ctx.ui.notify` on first projection (counts +
   where). `startup`-only (not `reload`) honours the owner's "respect
   preexisting config on start/reload" direction: a user who deliberately
   deleted a projected file should not have it silently restored on reload.
   The upgrade case (new built-ins shipped) is handled by `/teams seed`.
3. `/teams seed` subcommand in `team-commands.ts` for explicit re-projection
   (after upgrade / provider install / deliberate reset). Optional `--force`
   flag to overwrite projected copies the user has NOT edited (v1: keep
   simple — `seed` re-projects missing only; `--force` is a v1.1 refinement).
4. NO changes to `settings.ts`, `members.ts`, `team-handler-*.ts` selection
   logic, `team-registry.ts`, `team-paths.ts`, or shipped `config/teams/*.md`
   (beyond the separate trailing-space fix).
5. Tests: new `tests/teams/team-projection.test.ts` (temp homedir):
   - projects missing seeds verbatim on `session_start(startup)`;
   - does NOT overwrite an existing user file (preexisting edit preserved);
   - idempotent on repeated startup; `reload` projects only newly-added seeds;
   - honours a configured `teams.roots` user override;
   - body marker present; no `model:` stripping.
   - `team-config.test.ts` unchanged (shipped seeds stay test-locked).
6. No new dependencies. `npm run check` + `npm test` green.

**Known v1 residual risk (documented, deferred to v2):** because v1 keeps
`lastDefined`, a user who strips ALL `model:` lines from their live
`llm-council.md`/`navigator.md` re-triggers the §7 empty-defaults bug (loud
failure, not silent). Durable immunization = v2 seed-only-defaults ADR. The
verbatim projection itself never causes this; only a deliberate user edit
stripping all models does, and it fails loudly.

**v1.1 follow-up (not v1):** pre-flight model-availability check in the shared
handler path → actionable error listing unavailable pinned ids, the file path,
and available models (extends fusion's filter-then-loud-fail pattern to
debate/research/consult). Projection-time availability warnings are NOT done
at `session_start` (registry may be unpopulated → false positives); the
reliable, actionable check belongs at runtime in v1.1.

**v2 follow-up (ADR-deferred):** "defaults are packaged, not user-derived" —
make `resolveTeamSettings` defaults seed-only (closes the residual risk
permanently; own PR + tests). Also: `respectAbsent` projection policy (track
user deletion via a sidecar so projection doesn't restore a file the user
deliberately removed). Optional: `teams.defaults.*` settings schema to replace
the leaky `lastDefined` side-effect with a proper config path.

- Does stripping `model:` (B) push model selection onto `settings` defaults
  that are themselves pinned to shipped ids? Is a paired `settings`-defaults
  registry-awareness change needed in v1, or is it acceptable as a follow-up?
- Is auto-projection on `session_start(startup)` too implicit (writes to the
  user's home dir without asking)? Should v1 be command-only (§3.1 B) with a
  startup nudge instead?
- v1 teams-only vs projecting agents/prompts too — is a half-editable surface
  worse than a full one?
- Cross-platform: `~` expansion and `teams.roots` override already handled in
  `team-paths.ts`; confirm projection reuses those helpers, not hardcoded paths.
- Interaction with `pi install` (npm/git package install) vs `session_start` —
  projection is runtime, not package-install time. Is that acceptable per pi
  conventions for user → workspace settings?