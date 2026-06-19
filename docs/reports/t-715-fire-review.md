# T-715 FIRE Review — Post-T-681 Material Changes

Date: 2026-06-17
Status: active
Verdict: REVISE
Baseline: `main` at `d189cc9` (`main...origin/main`, clean at review start)
Scope: material changes since T-681 (`385c7e3..HEAD`) focused on internal fusion/router-fusion, `/team` session mode, file-watch symlink/UX follow-ups, template safety, Panopticon memory writer POC, and checkpoint readiness classifier. Exclusions: secrets, raw sessions, `.workers`, keyrings, private scratch, unrelated implementation.

## Executive summary

- REVISE, not no-go: checks are green and the architecture remains mostly FIRE-aligned, but `/team` fanout wording/gating is materially ambiguous because it treats `maxModels` as panel size while the actual team path may also run judge and synthesis calls.
- Internal `router-fusion` is restrained: direct handler, no generic DAG revival, no external OpenRouter/pi-fusion dependency, bounded panel, partial success, fallback, and tests.
- File-watch follow-ups improved gradual disclosure: symlink retarget handling and hidden metadata-only batches avoid overlay/file-content injection.
- Template safety, checkpoint readiness, and memory writer POC are small, native, and test-backed; memory writer remains appropriately temp-manifest-gated.
- No secret exposure or dependency bloat found in the reviewed slice.

## Evidence reviewed

Commits reviewed after T-681:

- `bb70eec` — checkpoint readiness classifier.
- `ca23067` — temp-gated Panopticon memory writer POC.
- `0c0e781` — template safety fixture check.
- `24179fb` / `c40efa8` — file-watch symlink retarget and UX/display follow-ups.
- `420c588` — internal fusion protocol and `router-fusion` team.
- `d189cc9` — `/team` session interaction mode.
- Supporting reports/artifacts: T-701..T-704 pi-fusion/OpenRouter assessments and topology proposal.

Key files reviewed:

- `extensions/pi-panopticon/teams/team-handler-fusion.ts`
- `extensions/pi-panopticon/teams/team-session-mode.ts`
- `extensions/pi-panopticon/teams/config/teams/router-fusion.md`
- `extensions/pi-panopticon/teams/checkpoint-readiness.ts`
- `extensions/pi-panopticon/ui/memory-writer.ts`
- `extensions/pi-file-watch/{watcher.ts,index.ts,README.md}`
- `scripts/check-template-safety.mjs`
- Relevant tests under `tests/teams`, `tests/pi-file-watch-config.test.ts`, `tests/template-safety.test.ts`, and `tests/panopticon/panopticon-memory-writer.test.ts`.

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | Local feedback is strong: targeted tests cover fusion planning/execution, session-mode parsing/prompt contract, checkpoint readiness, file-watch behavior, template safety, and memory writer. Full `npm run check` and `npm test` pass. | PASS |
| Inexpensive | No new dependencies or external services. Router-fusion uses existing team runner/model calls. File-watch remains native `fs.watch`. Memory writer uses native fs/crypto and is temp-manifest-gated. Cost risk exists only when `/team` is enabled by user. | PASS with follow-up |
| Restrained | Fusion was implemented as a direct protocol handler, not a generic router/DAG engine. `/team` is session-only and default-off. However, `maxModels`/approval wording over-promises total call count control. | REVISE |
| Elegant | Boundaries are mostly coherent: pure planner, direct handler, config manifests, docs, and focused tests. Minor elegance debt: `maxLoops` is reused as fusion panel size and `/team` relies on prompt transformation rather than a typed runtime path. | PASS with follow-ups |

## Clean Architecture / KISS / YAGNI / DRY assessment

### Clean Architecture

PASS with follow-up. Teams work stayed inside `extensions/pi-panopticon/teams` and reused `runTeamNode`, session run details, manifests, and registry plumbing. No core dependency inversion or cross-extension persistence coupling was introduced.

The `/team` mode is session-local and registered in `teams/register.ts`, but it is a prompt-transform shim that asks the active model to call `team_run`; it does not directly invoke the runtime. That keeps code small, but leaves behavior dependent on model compliance and weakens deterministic enforcement of fanout/trace rules.

### KISS

PASS. The fusion handler is a linear direct flow: plan -> panel -> fallback if needed -> judge -> synthesis. Checkpoint readiness is a pure classifier. Template safety is a fixed fixture scan. File-watch keeps one batching path.

### YAGNI

PASS with follow-ups. The implementation avoided external OpenRouter/pi-fusion dependencies, generic route engines, durable `/team` settings, recursive fusion, mutating panel tools, and new storage. Remaining YAGNI debt from T-681 persists: `FileWatchConfig.maxBytes` remains exposed despite no file-body injection.

### DRY

PASS. Existing shared helpers are reused (`runTeamNode`, record helpers, registry/model slot helpers, `buildFirewatchUpdate`). Some duplication in tests is acceptable as executable contract examples.

## Material findings

| Finding | Severity | Evidence | Recommendation |
|---|---:|---|---|
| `/team` fanout wording/gating is ambiguous. | Medium | `team-session-mode.ts` approval says “up to ${state.maxModels} team model calls”, but `router-fusion` with `limits.maxLoops=2` can still run 2 panel calls + judge + synthesis; `team-handler-fusion.ts` also estimates `panel.length + 1`, excluding synthesis. | Revise wording and/or gate semantics before broad rollout: call it `maxPanelModels`, or gate on estimated total calls including judge/synthesis. Add tests for transformed prompt and fusion planner call estimates. |
| `/team` mode is prompt-transform mediated, not runtime-enforced. | Low | `team-session-mode.ts` builds instructions telling the active model to use `team_run`; it does not call `runTeam` directly. | Accept for v1 if documented as assistant-mediated. For deterministic mode, create a follow-up POC to invoke `runTeam` directly from the input hook or a tool-free command path. |
| Router-fusion preserves restrained architecture. | Positive | `team-handler-fusion.ts`; tests cover order/caps/warnings, partial panel success, all-panel fallback, invalid judge JSON. | Keep as direct protocol. Do not introduce generic DAG/router engine unless a concrete workflow requires it. |
| Fusion tools default to none. | Positive | Built-in `fusion_*.md` agents declare `tools: []`; handler sets panel/judge/synthesis bindings with `tools: []`. | Preserve default; require separate approval for readonly or mutating tools. |
| File-watch UX now honors gradual disclosure. | Positive | `watcher.ts` sends `display: false`; `/file-watch` refreshes status only; tests assert no file content and hidden batch display. | Keep content/diff/overlay behavior behind separate design approval. |
| Symlink retarget handling is useful and bounded. | Positive | `restartFileWatch` restarts watcher state and schedules update for configured symlink path; tests cover target content and repointing. | No follow-up beyond monitoring `watcher.ts` size. |
| Checkpoint readiness classifier is safe and pure. | Positive | `checkpoint-readiness.ts` only classifies provided records/artifact refs; no artifact reads/mutations. | Keep future checkpoint resume behind approval/ADR; classifier alone is not a resume engine. |
| Memory writer POC is appropriately gated. | Positive | `memory-writer.ts` requires absolute manifest root with `allowMemoryPoc` and `rootType`; safe agent ids; bounded content; archive retention. | Keep POC temp-only until an ADR approves durable memory semantics. |
| Template safety check is narrow but effective. | Low | `scripts/check-template-safety.mjs` scans one fixture path with hard-coded rules; scan false-positive is the rule source itself in bounded grep. | If templates grow, expand to discover fixture/template roots instead of hard-coding one file. |
| Legacy file-watch `maxBytes` remains unused. | Low | T-681 finding still applies: `config.ts/types.ts` expose `maxBytes`; watcher no longer uses content body limits. | Remove or explicitly deprecate in a small cleanup ticket. |

## No-go conditions

None found.

Would become no-go if `/team` were enabled by default/persisted, if router-fusion gained mutating tools or recursive team invocation without approval, if file-watch reintroduced file-body/diff injection by default, or if memory/checkpoint POCs began reading/writing durable session/private state without ADR-backed policy.

## Follow-ups

1. **T-715-F1 (Medium): clarify `/team` fanout gate semantics.** Rename user-facing concept to `maxPanelModels` or compute estimated total calls including panel + judge + synthesis. Fix approval copy and add tests.
2. **T-715-F2 (Low): add behavioral tests for `/team` input hook.** Current tests cover parsing and prompt text; add fake API/input-hook tests for first-use approval denial, once-mode reset, slash-command bypass, extension-source bypass, large-context approval, and transform output.
3. **T-715-F3 (Low): decide whether `/team` should remain assistant-mediated.** If deterministic execution is required, design a direct runtime path. If not, document “assistant-mediated” explicitly.
4. **T-681 carryover (Low): remove/deprecate `FileWatchConfig.maxBytes`.** No content is injected, so the option is misleading.
5. **Future ADR gate:** durable checkpoint resume and Panopticon memory persistence need ADR before promotion from classifier/temp POC to runtime behavior.

## Reviewer disposition

Navigator/reviewer PASS: Navigator reviewed concrete `/team` and fusion-handler excerpts and agreed that REVISE, not BLOCK/no-go, is appropriate. It confirmed the fanout finding is evidence-backed: `maxModels=2` can mean two panel calls plus judge plus synthesis, while the approval copy says “up to 2 team model calls.” Caveat from reviewer: if product/security defines `--max-models` as a hard total call budget, this should become BLOCK.

ADR rationale: no new ADR is required for this review artifact. Existing changes are either local direct-handler/team UX behavior or POCs/tests. ADR is recommended before durable checkpoint resume, persistent memory, or deterministic `/team` runtime execution.

## Verification

- `git status --short --branch` — clean at review start on `main...origin/main`.
- `git diff --stat 385c7e3..HEAD -- ...` — reviewed material file set since T-681.
- `rg -n "FIRE|F\.I\.R\.E\.|Dan Ward|KISS|YAGNI|DRY|Clean Architecture" docs skills tests extensions README.md` — prior review context found and considered.
- `git diff --check` — PASS.
- Bounded secret scan over reviewed docs/teams/file-watch/scripts/tests — PASS; only false-positive was the literal regex rule in `scripts/check-template-safety.mjs`.
- `npx vitest run tests/teams/team-fusion-handler.test.ts tests/teams/team-session-mode.test.ts tests/teams/checkpoint-readiness.test.ts tests/pi-file-watch-config.test.ts tests/template-safety.test.ts tests/panopticon/panopticon-memory-writer.test.ts` — PASS, 6 files / 32 tests.
- `npm run check` — PASS: namespace, template safety, typecheck, lint, knip, type coverage 99.32%.
- `npm test` — PASS: 95 files / 796 tests.

## Final status

REVISE: no no-go issue found, but `/team` fanout/cost semantics should be corrected or explicitly documented before broad human-facing rollout.
