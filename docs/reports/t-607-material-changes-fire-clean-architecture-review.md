# T-607 Material Changes FIRE / Clean Architecture Review

Date: 2026-05-29
Baseline reports: T-477 (`f9ab2f3`), T-494 artifact (`44162dc`) covering code range `f9ab2f3..0613eb5`
Reviewed range: material changes after T-494's reviewed endpoint, `0613eb5..55b397e`; evidence docs after `44162dc` were also inspected
Recommendation: **PASS with follow-ups**

## Scope

This review examined material repo changes since T-477/T-494, with T-316 as supporting pi-teams integration evidence. T-607 itself is review-only: it adds only this report and includes no runtime, public API, credential, `STATE`, `pi-kanban` board-state, `.workers`, or broad refactor mutation. The historical range reviewed does include runtime-related changes, assessed below.

Primary evidence reviewed:

- Prior reviews: `docs/reports/t-477-fire-quality-review.md`, `docs/reports/t-494-clean-architecture-kiss-yagni-dry-review.md`.
- pi-teams evidence: `docs/reports/t-310-pi-teams-worktree-isolation-poc.md`, `docs/reports/t-316-pi-teams-merge-readiness.md`, `docs/reports/t-318-pi-teams-result-state-detail-surface-audit.md`, `docs/reports/t-319-pi-teams-handoff-boundary.md`, ADR 021, ADR 023, ADR 024.
- Panopticon memory evidence: ADR 022, `docs/reports/t-595-panopticon-memory-renderer-poc.md`, `docs/reports/t-597-panopticon-memory-reader-design.md`, `extensions/pi-panopticon/memory-renderer.ts`, `tests/panopticon-memory-renderer.test.ts`.
- pi-kanban lifecycle evidence: `docs/reports/t-264-task-lifecycle-model.md`, `extensions/pi-kanban/lifecycle.ts`, `tests/pi-kanban-lifecycle.test.ts`, `tests/pi-kanban-lifecycle-board-compat.test.ts`.
- Session/research-tool evidence: `docs/reports/t-507-session-source-discovery.md`, `docs/reports/t-553-registered-research-tools-migration.md`, `docs/reports/t-576-provider-backed-research-tools-prep.md`, affected `lib/`, `extensions/pi-research-tools/`, and tests.

## Material change inventory

| Area | Representative commits / files | Material change | Review result |
|---|---|---|---|
| Session spooling/source discovery | `9dab952`, `b45fc32`, `a8394cd`, `0907f5a`, `1141352`; `lib/session-spool*.ts`, `lib/session-source-discovery.ts` | T-494 concerns were narrowed: hook CLI logic was consolidated, speculative pruning removed, atomicity clarified, and source discovery stayed explicit/read-only. | **PASS**. Improves DRY/KISS without changing default hook posture. |
| Research tools | `f193166`, `5475238`; `extensions/pi-research-tools/`, `lib/research-tool-*`, ADR 020 | Dry-run/metadata and fake-provider contract scaffolding were added without live providers, credentials, persistence, or prompt/runtime deletion. | **PASS**. Good YAGNI boundary; keep provider promotion gated. |
| pi-teams runtime hardening | `6325e7f`, `a722106`, `aeddb76`, `f5ff48f`, `31f2ff0`; `extensions/pi-teams/*`, team tests | Fallback semantics, state/detail tests, handoff routing validation, and worktree isolation POC were added. T-316 found merge-ready with follow-ups. | **PASS** under internal/provisional boundaries. |
| pi-teams contract disposition | `a037c26`, `a34f992`, `3367617`; ADR 021/023/024 | Checkpoint/resume remains design-only; approval gates quarantined; observability JSONL stays internal/provisional. | **PASS**. Directly addresses T-494 API-clarity risks. |
| Panopticon memory | `7d0fcda`, `bdeb7f3`, `4c0442f`; ADR 022, T-595, T-597, renderer tests | Snapshot architecture was specified, a synthetic-only renderer was added, and reader/UI behavior remains design-only. | **PASS**. FIRE-positive if it remains claim-check/advisory only. |
| pi-kanban lifecycle | `f972372`, `d33fbfd`, `55b397e`; T-264, lifecycle helper/tests | Canonical lifecycle v1 and an internal pure helper/tests were added without board-log migration or tool behavior change. | **PASS**. Clean boundary; T-477 adaptive capacity remains unimplemented follow-up. |
| Recurring workflows/templates | `1be96f4`; `docs/templates/pi-teams-recurring-workflows.md` | Static SOP templates and docs links only; no scheduler/runtime command. | **PASS**. KISS/YAGNI fit. |

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | Recent changes generally add bounded helpers/tests/docs rather than broad framework work. Handoff validation and live-agent fallback fixes reduce invalid runtime detail emission quickly. | **PASS** |
| Inexpensive | The repo continues to prefer local files, TypeScript helpers, temp-repo tests, fake-provider fixtures, and no new service dependency. | **PASS** |
| Restrained | The strongest pattern since T-494 is explicit restraint: checkpoint/resume, observability, approvals, worktree runtime use, Panopticon memory reads/writes, and provider-backed tools are all gated. | **PASS** |
| Elegant | Event/log/state boundaries remain understandable: kanban lifecycle is pure, team state has pinned internal surfaces, memory snapshots are advisory claim-checks, and research tools declare metadata before providers. | **PASS with follow-up**: add budgets/redaction before any diagnostic surface leaves local/internal use. |

## Clean Architecture / KISS / YAGNI / DRY assessment

### Clean Architecture

**PASS.** Policy/mechanism separation improved since T-494:

- Approval and observability risks now have explicit disposition ADRs instead of relying on convention.
- `handoff.ts` separates parse/resolve/route concerns and rejects non-routable targets before detail emission.
- `lifecycle.ts` models kanban lifecycle interpretation without importing scheduler policy or mutating `board.log`.
- Research-tool provider preparation separates provider-neutral contracts from live provider adapters.

Main caveat: exported internal helpers (`approval-gates.ts`, `observability.ts`, `worktree-isolation.ts`) can still look more stable than intended. Their docs/ADRs currently mitigate this; do not promote them by README examples or tool wiring without ADR.

### KISS

**PASS.** Most new artifacts are small and single-purpose. The best examples are the lifecycle helper, synthetic memory renderer, fake-provider contract tests, and handoff router. Worktree isolation is the most complex new helper, but it is justified as an isolated POC and remains unwired.

### YAGNI

**PASS with explicit hold lines.** The repo avoided premature runtime enablement in high-risk areas:

- No real `MEMORY.md` reader/writer.
- No `team_resume` or checkpoint store.
- No public observability JSONL contract.
- No live research provider calls.
- No kanban board migration.
- No default worktree allocation.

The only YAGNI risk is future misuse of existing POCs as implied contracts. Keep the promotion gates visible.

### DRY

**PASS.** The largest T-494 DRY issue, duplicated hook installer policy, was materially improved by CLI consolidation. New duplication is mostly documentation restatement across ADRs/reports, which is acceptable because those docs encode safety boundaries for separate promotion paths.

## Risks and no-go conditions

No release-blocking defect was found. Do **not** proceed without new ADR/reviewer approval for any of these promotions:

1. Treating `TeamObservabilityEvent`/JSONL as public, durable, external telemetry, audit, billing, resume, or approval evidence.
2. Wiring approval gates into default team runtime or mutating-tool authorization.
3. Enabling checkpoint/resume writer/reader or using diagnostics as resume truth.
4. Enabling `worktree-isolation.ts` from `team_run`, adding public config/tools for it, or auto-merging isolated worker changes.
5. Reading or writing real Panopticon `MEMORY.md` snapshots, adding registry schema fields, or showing snapshot content in `agent_peek`/`/agents`.
6. Running research tools against live providers, credentials, network, or persistent artifacts by default.
7. Migrating `pi-kanban/board.log`, changing persisted column spellings, adding scheduler policy to pi-kanban, or adding reopen/cancel semantics.

## Follow-ups

Priority follow-ups:

1. **pi-kanban adaptive capacity remains open from T-477.** Implement only as an audited event-sourced capacity MVP after review; do not infer capacity automatically.
2. **pi-teams detail budget.** Before public/durable use, add byte/redaction budgets for `run_detail.message`, `data`, `artifactUri`, `error`, and observability projections.
3. **Worktree promotion design.** If runtime isolation is desired, first design branch ownership, stale lock cleanup, symlink/realpath/base-ref hardening, merge/report-only flow, and approval gates.
4. **Panopticon memory storage decision.** Decide storage root, retention/reap policy, visibility, stale handling, and UI contract before any real reader/writer.
5. **Research provider pilot gate.** Keep fake-provider tests and credential-redaction tests mandatory before any live adapter.
6. **Public extension contract checklist.** Add short “does/does-not-do” sections for extensions that expose internal helpers to reduce accidental contract promotion.

## ADR disposition

No new ADR is required for T-607 because this artifact is a review report only and changes no runtime behavior, schema, public API, persistence, provider, UI, or tool contract.

Existing ADR coverage is sufficient for the reviewed material:

- ADR 017: session spooling lifecycle/hook boundary.
- ADR 018: pi-teams state/detail internal boundary.
- ADR 019: COAS/kanban scheduling ownership boundary.
- ADR 020: provider-backed research-tools gate.
- ADR 021: checkpoint/resume design-only boundary.
- ADR 022: Panopticon memory snapshot design boundary.
- ADR 023: approval-gate quarantine.
- ADR 024: observability JSONL internal/provisional disposition.

## Verification

Review commands/evidence:

- `git status --short --branch` — clean at start: `main...origin/main` at `55b397e`.
- `git log --oneline --decorate -25` — confirmed recent material commits through `55b397e`.
- `git diff --stat 0613eb5..HEAD` and `git diff --name-only 44162dc..HEAD` — scoped material changes since T-494.
- Read prior and supporting reports/ADRs listed in Scope.

Validation completed for this docs-only report before commit:

- Markdown grep/self-check for accidental forbidden paths/secrets — PASS; one false-positive grep hit on `pi-kanban-lifecycle` only.
- `npm run check` — PASS.
- `npm test` — PASS, 68 files / 647 tests.
- Navigator/reviewer — PASS with non-blocking wording fixes incorporated.

## Final status

Current report recommendation: **PASS with follow-ups**.

Commit/push status: this report is intended to be the only T-607 repo mutation and will be committed/pushed as the docs-only change adding `docs/reports/t-607-material-changes-fire-clean-architecture-review.md`. The final T-607 DONE/BLOCKED message records the exact pushed commit hash and reviewer result.
