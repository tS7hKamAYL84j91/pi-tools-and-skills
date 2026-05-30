# T-631 FIRE Review — Panopticon Capability Consolidation

Date: 2026-05-30
Status: active
Baseline reports: T-477 FIRE review, T-607 material changes FIRE / Clean Architecture review
Reviewed head: `1845c4a` (`refactor(panopticon): organize capability modules`)
Recommendation: **PASS with follow-ups**

## Scope

This review covers the current repository after the Panopticon/Teams consolidation and capability-folder refactor.

Primary evidence reviewed:

- Current working tree and latest commit: `git status --short --branch`, `git log --oneline -10`, `git diff --stat HEAD~1..HEAD`.
- Panopticon module layout under `extensions/pi-panopticon/`.
- Prior quality reviews: T-477 and T-607 FIRE/Clean Architecture reports retained in git history.
- Active public/internal boundary docs: `extensions/pi-panopticon/README.md`, `docs/deep-dives/teams-platform.md`, `docs/architecture.md`.
- Architecture/test guardrails: namespace check, runtime-state boundary checks, knip, type coverage, and Vitest.

This is a review artifact plus one active stale-comment cleanup in `tests/messaging.test.ts`; it does not introduce runtime behavior, tool, command, schema, provider, persistence, or UI changes.

## Executive summary

The repo remains strongly FIRE-aligned. The latest Panopticon refactor improves elegance and restraint by making the physical module layout match the runtime ownership model:

- `extensions/pi-panopticon/` root contains only the extension entrypoint, root shared types, package metadata, and README.
- Agent/runtime capabilities live in `ui/`, `registry/`, `messaging/`, and `spawner/`.
- Team orchestration lives in `teams/`, not as a standalone extension.
- Public compatibility is documented as tools, commands, settings/package entrypoints, and persisted event names; deep file paths are internal.

Recommendation: **PASS with follow-ups**. No release-blocking FIRE issue was found. The main follow-ups are to keep large capability files from growing further, preserve the `pi-teams:run` compatibility literal intentionally, and avoid promoting provisional team observability/approval/worktree helpers without ADR-backed gates.

## FIRE assessment

| Lens | Current finding | Disposition |
|---|---|---|
| Fast | The capability layout makes target files easier to find and keeps tests importing precise modules. Public tool/command behavior remains unchanged and validated. | **PASS** |
| Inexpensive | The repo keeps local files, Node primitives, session events, fake-provider/test fixtures, and no new service dependency. The refactor is mostly renames/import repairs. | **PASS** |
| Restrained | Root compatibility shims were removed instead of preserving arbitrary deep-import surfaces. Teams are modular under Panopticon without reintroducing standalone package/runtime ownership. | **PASS** |
| Elegant | Physical folders now match capabilities and docs declare public vs internal boundaries. Persisted `pi-teams:run` is retained as a compatibility detail instead of forcing a cosmetic migration. | **PASS with follow-ups** |

## Clean Architecture / KISS / YAGNI / DRY assessment

### Clean Architecture

**PASS.** The current boundary is clearer than before:

- Panopticon owns runtime substrate: registry, health, messaging, spawning, UI, and runtime/team tool surface.
- Teams own protocol behavior under `extensions/pi-panopticon/teams/`.
- The root Panopticon package is now an orchestrator and public metadata boundary, not a dumping ground for every module.
- Architecture exceptions were updated to the moved implementation paths, preserving guardrail intent.

Caveat: `registry/` is a broad metadata-plane capability. It currently contains records, visibility, health, peer lookup, reconciliation, and operational state. That is acceptable now because all are agent metadata-plane concerns, but future runtime entity expansion should not make `registry/` a catch-all.

### KISS

**PASS.** The refactor avoided capability barrels and compatibility shims after tests were updated. Direct capability imports are simple and explicit.

Caveat: several files remain large by line count, especially:

- `extensions/pi-panopticon/ui/agent-overlay.ts` (446 lines)
- `extensions/pi-panopticon/teams/state.ts` (436 lines)
- `extensions/pi-panopticon/teams/team-overlay.ts` (420 lines)
- `extensions/pi-panopticon/registry/registry.ts` (410 lines)
- `extensions/pi-panopticon/spawner/spawner-tools.ts` (393 lines)

These are acceptable legacy hotspots, but new behavior should extract focused helpers rather than growing them further.

### YAGNI

**PASS.** No new generalized runtime framework, graph executor, template engine, metrics store, or public team observability contract was introduced. The current design keeps direct protocol handlers and explicit runtime control-plane surfaces.

Hold lines remain:

- Do not rename `pi-teams:run` without a session-state migration need.
- Do not promote approval gates, observability JSONL, checkpoint/resume, or worktree isolation from internal/provisional status without ADR and tests.
- Do not add compatibility shims for old deep imports unless a documented external consumer exists.

### DRY

**PASS.** The split reduces conceptual duplication between Panopticon and Teams by making Teams a Panopticon module. Some docs intentionally repeat safety boundaries across ADRs/reports; that is acceptable because they are separate decision records.

## Material findings

| Finding | Severity | Recommendation |
|---|---:|---|
| Capability layout now matches ownership and improves navigation. | Positive | Keep root limited to `index.ts`, `types.ts`, package metadata, and README. |
| Root deep-import shims are gone. | Positive with compatibility caveat | Treat tools/commands and package entrypoint as public; avoid re-adding shims unless a real external consumer is documented. |
| Persisted event name remains `pi-teams:run`. | Positive | Keep the compatibility comment in `teams/state.ts`; do not rename for cosmetic alignment. |
| `registry/` is broad. | Medium follow-up | If it grows, split `operational-state/` or `runtime/` only when concrete new code would otherwise blur the boundary. |
| Large UI/state/runtime files remain hotspots. | Medium follow-up | Extract helpers only when modifying those areas for real features or defects; avoid refactor-only churn. |
| Ignored `.pi/settings.json` can drift locally. | Low operational | Document or script local package settings regeneration; do not rely on ignored local settings as release evidence. |

## No-go conditions

Do not proceed with any of these without a new ADR/reviewer approval:

1. Making `TeamObservabilityEvent`/JSONL public, durable, external telemetry, audit, billing, resume, or approval evidence.
2. Wiring approval gates into default team execution or tool authorization.
3. Adding team checkpoint/resume storage or replay semantics.
4. Enabling worktree isolation by default from `team_run`, auto-merging worker branches, or exposing it as a public runtime promise.
5. Reading/writing real Panopticon `MEMORY.md` snapshots without the storage/retention/UI decision from ADR 022 follow-ups.
6. Reintroducing a generic team graph/topology executor without a concrete workflow that direct handlers cannot support.
7. Re-adding old root compatibility shims for internal file paths without a documented external compatibility requirement.

## Follow-ups

1. **Hotspot containment:** when touching `agent-overlay.ts`, `teams/state.ts`, `team-overlay.ts`, `registry.ts`, or `spawner-tools.ts`, extract small pure helpers around the modified concern.
2. **Registry capability naming watch:** keep `registry/` as the metadata-plane home for now; revisit only if non-registry runtime entity logic starts accumulating there.
3. **Local settings hygiene:** consider a check or documented command to detect ignored `.pi/settings.json` drift after package-layout changes.
4. **Public/internal boundary tests:** current README wording is sufficient; add a focused test only if root shims or deep-import compatibility accidentally returns.
5. **Carry forward T-477/T-607 follow-ups:** adaptive kanban capacity, team detail budgets/redaction, worktree promotion design, Panopticon memory storage decision, and research provider pilot gate remain open.

## Verification

Commands/evidence used for this review:

- `git status --short --branch` — clean at start on `main...origin/main`.
- `git log --oneline -10` — confirmed latest head `1845c4a`.
- `git diff --stat HEAD~1..HEAD` — inspected the consolidation/refactor shape.
- `find extensions/pi-panopticon -maxdepth 2 -type f` — verified root/capability folder layout.
- `wc -l extensions/pi-panopticon/{index.ts,types.ts} extensions/pi-panopticon/*/*.ts` — identified current hotspots.
- Stale path grep for standalone `extensions/pi-teams`, old root Panopticon paths, and legacy standalone filenames — no active docs/extensions hits after cleanup; one test comment was corrected.
- Risk grep for direct writes/child processes confirmed existing bounded exceptions: registry sync write, Maildir protocol writes, runtime child-process adapters, and experimental worktree isolation.
- Prior validation before this report: `npm run check` passed and `npm test` passed with 704 tests after the refactor.

## Final status

Current FIRE recommendation: **PASS with follow-ups**.
