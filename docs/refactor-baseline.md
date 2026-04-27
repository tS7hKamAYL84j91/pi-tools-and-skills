# Refactor baseline

Date: 2026-04-25

Purpose: capture the current state before any structural refactor, so we can distinguish pre-existing issues from regressions.

## Repository shape observed

- `extensions/` — Pi extension entrypoints
- `lib/` — shared implementation code
- `skills/` — skill assets and/or skill entrypoints
- `prompts/` — prompt assets
- `memories/` — memory assets/state
- `tests/` — Vitest suite
- `scripts/` — repo helper scripts
- `coas-infra/` — infra/config assets
- `README.md`, `package.json`, `tsconfig.json`, `biome.json`, `knip.json`

## Current package commands

From `package.json`:

- `npm run typecheck` → `tsc --noEmit`
- `npm run lint` → `biome lint extensions/ lib/ tests/`
- `npm run type-coverage` → `type-coverage --strict --at-least 95`
- `npm run check` → typecheck → lint → knip → type-coverage
- `npm run test` → `vitest run`
- `npm run test:watch` → `vitest`
- `npm run knip` → `knip`

## Baseline invariants to preserve

- Existing extension registration names and lifecycle behavior
- Existing script invocation behavior
- Existing `prompts/`, `skills/`, and `memories/` path semantics
- Current ESM/runtime module resolution behavior
- Current test expectations and coverage shape
- No accidental behavior changes while moving code

## Baseline checks to run

Recorded 2026-04-25 23:36 UTC, commit `6e01181` (working tree clean).

| Check | Result | Notes |
|---|---|---|
| install (`npm install`) | PASS | clean install, no warnings |
| typecheck (`npm run typecheck`) | PASS | tsc --noEmit, 0 errors |
| lint (`npm run lint`) | PASS | biome, 85 files, 0 errors |
| knip (`npm run knip`) | PASS¹ | 1 configuration hint (pre-existing): suggests removing `@mariozechner/pi-tui` from `ignoreDependencies` in knip.json |
| type-coverage | PASS | 98.84% (23 653 / 23 929), threshold ≥95% |
| test suite (`npm test`) | PASS | 307 tests across 26 files, ~1.3s |
| extension smoke (`pi --mode rpc`) | PASS | extensions load, abort RPC returns success=true; panopticon emits status updates, no errors |
| script smoke (`scripts/setup-pi --help`) | PASS | exits 0 |
| script smoke (`scripts/clean-mailboxes --dry-run`) | PASS | exits 0, walks `~/.pi/agents/` and reports stale/live counts |
| content path resolution | PASS | `make setup` registers package, `pi list` shows it; `pi --tools council_list` invoked council successfully (verified in earlier session) |

¹ The knip hint is informational, not an error. The package builds even with the dependency listed; pre-existing.

## Entry points and dynamic loading

### Extension entrypoints
Each `extensions/<name>/index.ts` default-exports `(pi: ExtensionAPI) => void`.

| Extension | Tools | Commands |
|---|---|---|
| council | `council_form` `council_update` `council_list` `council_dissolve` `ask_council` | `council-form` `council-list` `council-edit` `council-ask` `council-dissolve` `council-last` |
| kanban | `kanban_create/pick/claim/complete/block/note/snapshot/monitor/unblock/move/delete/compact/edit/reassign` | — (flag `--prod`) |
| pi-cheatsheets | `mmem_create` `mmem_list` `mmem_inject` `mmem_update` `mmem_validate` | `mmem` `mmem-reload` |
| matrix | — (registers `MatrixTransport` via `registerChannel`) | `matrix` |
| pi-panopticon | `agent_send` `agent_broadcast` `spawn_agent` `rpc_send` `list_spawned` `kill_agent` `agent_peek` | `/send` `/agents` `/alias` |

### Scripts (`scripts/`)
| Script | Reads | Writes | Embedded |
|---|---|---|---|
| `setup-pi` | `~/.pi/agent/settings.json`, `~/.pi/agent/models.json`, shell rc, `~/.pi/agent/AGENT.md` | settings.json, models.json, shell rc | inline Python (json mutation) |
| `setup-pi-clean` | settings.json, shell rc | settings.json, shell rc | inline Python |
| `clean-mailboxes` | `~/.pi/agents/*` directory tree | (with `--dry-run`: nothing) | — |

### Content loaders / parsers
- Settings readers (3): `extensions/pi-cheatsheets/discover.ts:46-57` `readSettingsMemoryPaths()`, `extensions/council/settings.ts:68-79` `readCouncilSettings()`, `extensions/matrix/config.ts:26-34` `readMatrixSettings()`.
- Directory scans: `extensions/council/state.ts:101`, `extensions/kanban/board.ts:71`, `extensions/pi-cheatsheets/discover.ts:71`, `extensions/pi-panopticon/registry.ts:301`.
- Atomic writes: `extensions/council/state.ts:54-59` (tmp/ → rename), `lib/transports/maildir.ts:104-128` `durableWrite` (same pattern).

### Repo-root / path helpers
- `homedir()` + `.pi/agent/...` literals appear in `lib/agent-registry.ts:23`, `extensions/council/state.ts:24`, `extensions/council/settings.ts:24`, `extensions/pi-cheatsheets/discover.ts:21`, `extensions/matrix/config.ts:13-14`.
- `dirname(process.execPath)` for pi binary: `lib/spawn-service.ts:20` (resolved once at module load).

### Top-level side effects
- `extensions/kanban/board.ts:15` `parseInt(process.env.KANBAN_WIP_LIMIT ?? "3", 10)` at module load.
- `lib/spawn-service.ts:31` `const PI_BINARY = resolvePiBinary()` runs `execSync("which pi")` at module load (intentional caching).
- `extensions/pi-cheatsheets/index.ts:26-28` mutable module-level state populated on `session_start`.

No surprising top-level side effects (no network calls, no file writes at load).

## Known pre-existing issues

- Knip configuration hint: `@mariozechner/pi-tui` listed in `ignoreDependencies` could be removed. Cosmetic, not blocking.

## Refactor 2026-04-25 — extract pi-settings reader

**Scope:** unify three independent `~/.pi/agent/settings.json` reader implementations.

**New:** `lib/pi-settings.ts` exports `readPiSettingsKey(key, path?)` and `PI_SETTINGS_PATH`. Returns the raw `unknown` value at the top-level key; caller narrows. Returns `undefined` for missing file, malformed JSON, or absent key. New tests at `tests/pi-settings.test.ts` (6 cases).

**Updated consumers:**
- `extensions/council/settings.ts:readCouncilSettings` — now narrows `readPiSettingsKey("council")` instead of inline try/catch.
- `extensions/pi-cheatsheets/discover.ts:readSettingsMemoryPaths` — same.
- `extensions/matrix/config.ts:readMatrixSettings` — same.

**Behavior preserved:**
- Each consumer's return shape unchanged (`{}`, `[]`, or `null` respectively).
- Each consumer's pre-existing test suite still passes (matrix-extension.test.ts; council/pi-cheatsheets tested via integration paths).
- Path resolution to `~/.pi/agent/settings.json` unchanged.
- No new module-load side effects.

**Stop-condition checks (all clear):**
- Extension registrations unchanged.
- Script invocation unchanged.
- Prompt/skill/memory resolution unchanged (pi-cheatsheets loader returns same paths for same input).
- TypeScript + runtime ESM both pass.
- Knip flags no new unused exports.
- No new circular dependencies.
- All 307 pre-existing tests pass alongside 6 new lib tests (313 total).

**What was NOT extracted (deliberately):**
- Atomic file write (`tmp/` → `rename`) — present in `extensions/council/state.ts` and `lib/transports/maildir.ts`. Single-call-site after the maildir version which has its own constraints (filename pattern, return shape). Not worth the churn for one consumer.
- Directory scanners — different shapes per scanner (`.md` vs `.mmem.yml` vs JSON registry records). Not duplication.
- Path constants (`homedir() + ".pi/agent/..."`) — each is a legitimate, distinct concern (councils dir, registry dir, matrix sync dir). Not duplication.

## Refactor stop conditions

Pause and re-evaluate if any of the following occur:

- extension registration changes unexpectedly
- scripts need new runtime assumptions
- prompt/skill/memory resolution changes
- TypeScript passes but runtime ESM fails
- Knip reports a large, surprising unused set
- circular dependencies appear
- tests only pass after weakening assertions

## Notes

- This document is intentionally boring. That is the point.
- Do not delete or “clean up” anything until the baseline has been recorded.
