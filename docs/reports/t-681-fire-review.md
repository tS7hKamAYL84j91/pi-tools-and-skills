# T-681 FIRE Review — Recent Platform and Extension Changes

Date: 2026-06-12
Status: active
Verdict: PASS with follow-ups
Baseline: `main` at `fdef854` (`main...origin/main`, clean at review start)
Scope: recent platform/extension changes, especially `pi-file-watch` T-676..T-679, plus recent `pi-goal`, worktree git hardening, and session-spool temp-file hardening. Exclusions: secrets, raw credential/session dumps, `.workers`, unrelated repos.

## Executive summary

- PASS with follow-ups: no release-blocking FIRE, Clean Architecture, KISS, YAGNI, DRY, or security regression found in the reviewed slice.
- `pi-file-watch` now follows gradual disclosure: it emits metadata-only `firewatch_batch` messages after a configurable batch window and never injects file bodies.
- Recent security changes are restrained and useful: git worktree helpers add argument separators, and session-spool temp files use UUID names.
- Recent `pi-goal` overlay work improves UI restraint by moving verbose goal details out of the persistent widget.
- Non-blocking cleanup: `FileWatchConfig.maxBytes` is now legacy/dead config after content injection removal and should be removed or explicitly deprecated.

## Evidence reviewed

- Commits:
  - `83ba292` — remove file-watch content injection.
  - `2ecf244` — align file-watch metadata contract with `firewatch_update` fields.
  - `e8aff3e` — remove noisy content placeholder.
  - `fdef854` — add `firewatch_batch` batching/coalescing.
  - `b1a8fff` — show goal details in overlay.
  - `f7ff87d` / `e6e4a64` — git worktree argument hardening.
  - `f9eb7c9` / `e6e4a64` — session-spool UUID temp paths.
- Files reviewed:
  - `extensions/pi-file-watch/{watcher.ts,config.ts,types.ts,README.md}`
  - `tests/pi-file-watch-config.test.ts`
  - `extensions/pi-goal/{goal-extension.ts,goal-overlay.ts}`
  - `tests/goal/pi-goal-tools.test.ts`
  - `extensions/pi-panopticon/teams/worktree-isolation.ts`
  - `lib/session-spool.ts`
  - Prior review context: `docs/reports/t-631-fire-review.md`, `docs/architecture.md`.

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | File-watch changes are locally testable, have focused unit coverage, and reduce noisy autosave turns via `batchWindowMs` defaulting to two minutes. Goal overlay and security fixes remain small, easy to inspect, and covered by existing tests. | PASS |
| Inexpensive | No new dependency or service was added. Hashing uses native Node `crypto`; watchers still use `node:fs.watch`; session-spool uses native `randomUUID`. Operational cost is lower because file-watch emits fewer, smaller messages. | PASS |
| Restrained | The file-watch contract now emits only metadata (`path`, `event`, `hash`, `byte_size`, `mtime`, `target`, `change_count`, batch window fields). It explicitly avoids opt-in body inclusion, diff behavior, recursive scans, or content persistence. | PASS |
| Elegant | Boundaries are coherent: config parsing stays in `config.ts`, file metadata/event behavior stays in `watcher.ts`, tests cover contract behavior, and README explains the public event shape. Goal overlay separates detail display from persistent status. | PASS with follow-up |

## Clean Architecture / KISS / YAGNI / DRY assessment

### Clean Architecture

PASS. The extension boundary remains thin and local:

- `index.ts` registers lifecycle hooks, tools, and command surface.
- `config.ts` owns parsing/defaults for `.pi/file-watch.json`.
- `watcher.ts` owns filesystem watching, metadata extraction, batching, and message emission.
- Tests exercise public helper behavior without reaching into unrelated runtime state.

No core package dependency reversal or cross-extension coupling was introduced. The git worktree and session-spool changes remain in their existing ownership boundaries.

### KISS

PASS. The file-watch batching model is a single timer plus a map keyed by real path. It coalesces repeated changes and sends one `firewatch_batch` event, avoiding multiple modes or policy abstractions.

Caveat: `watcher.ts` has grown from a tiny helper into the main extension behavior file. It is still readable, but future additions should extract only concrete concerns rather than adding a broader event framework.

### YAGNI

PASS with one cleanup follow-up. The implementation resisted adding content inclusion, changed-line diffs, recursive watchers, persistence, or notification policy modes. However, `FileWatchConfig.maxBytes` remains from the old bounded-content path and is now unused; keeping it long-term would be YAGNI/config confusion.

### DRY

PASS. The metadata builder `buildFirewatchUpdate` is reused for batched final-state changes, avoiding duplicate hash/size/mtime logic. README and tests repeat the event contract intentionally as user-facing documentation and executable specification.

## Material findings

| Finding | Severity | Evidence | Recommendation |
|---|---:|---|---|
| Gradual disclosure violation is remediated. | Positive | `extensions/pi-file-watch/watcher.ts` emits `firewatch_batch`/metadata only; tests assert no watched file body such as `two` appears. | Keep content/diff additions out until separate design approval. |
| Autosave noise is mitigated with bounded batching. | Positive | `batchWindowMs` default is `120000`; repeated changes coalesce with `change_count` in `tests/pi-file-watch-config.test.ts`. | Monitor real usage; reduce default only if users report latency harm. |
| Deleted/unreadable files degrade gracefully. | Positive | `buildFirewatchUpdate` catches stat/hash errors and returns path/event/target-only metadata. | Keep this behavior; avoid throwing from watcher callbacks. |
| Legacy `maxBytes` config remains after removing content reads. | Low | `extensions/pi-file-watch/config.ts` and `types.ts` still expose `maxBytes`; `watcher.ts` no longer uses it. | Create a cleanup ticket to remove/deprecate `maxBytes` unless a near-term approved content/diff feature needs it. |
| Goal detail overlay reduces persistent UI noise. | Positive | `b1a8fff` moves detailed goal status into `goal-overlay.ts` and simplifies `compactWidget`. | No ADR needed; local UI behavior only. |
| Security hardening is small and appropriate. | Positive | Worktree git commands add `--`; session-spool temp path uses `randomUUID`. | No follow-up required beyond existing tests. |

## No-go conditions

None found for the reviewed slice.

Would become no-go if future changes reintroduce default file-body injection, raw diffs, recursive discovery, auto-reading broad paths, or public durable event semantics without a separate design/ADR and tests.

## Follow-ups

1. **TBD cleanup ticket:** remove or explicitly deprecate unused `FileWatchConfig.maxBytes` now that file-watch no longer injects content. Severity: Low.
2. **Future-design gate:** any opt-in content/diff/changed-lines feature should get separate approval, bounded privacy rules, and tests before implementation.
3. **Hotspot watch:** if `extensions/pi-file-watch/watcher.ts` grows further, extract concrete pure helpers around batching/metadata; do not add a generic event framework.

## ADR rationale

No new ADR is required for the reviewed changes. The file-watch work is a local extension contract correction and noise-control improvement, not a new persistence model, public cross-process protocol, policy engine, or architecture boundary change. If `firewatch_batch` becomes an externally versioned API or durable event format, an ADR should be reconsidered.

## Reviewer check

Navigator review result: PASS with one non-blocking follow-up to remove/deprecate legacy `maxBytes`. Navigator also advised checking downstream docs/consumers for content expectations; README and tests now document metadata-only behavior.

## Verification

- `git status --short --branch` — clean at review start on `main...origin/main`.
- `git log --oneline --decorate -12` — confirmed reviewed head and recent commits through `fdef854`.
- `git show --stat --oneline 83ba292 2ecf244 e8aff3e fdef854 b1a8fff e6e4a64 f7ff87d f9eb7c9 --` — inspected changed-file shape.
- `rg -n "FIRE|F\\.I\\.R\\.E\\.|Dan Ward|KISS|YAGNI|DRY|Clean Architecture" docs skills tests extensions README.md` — prior review context found and considered.
- `git diff --check` — passed.
- Bounded secret grep on reviewed paths — no matches.
- `npm test -- tests/pi-file-watch-config.test.ts tests/goal/pi-goal-tools.test.ts tests/teams/team-worktree-isolation.test.ts` — passed: 3 files, 27 tests.
- `npm run check` — passed: namespace, typecheck, lint, knip, type-coverage 99.30%.
- `npm test` — passed: 90 files, 772 tests.

## Final status

DONE/PASS with follow-ups: reviewed changes are shippable; track `maxBytes` cleanup and keep any future content/diff behavior behind separate design approval.
