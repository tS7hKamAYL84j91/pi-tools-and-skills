# corr_pi_ext_improvements_goal Plan

Status: active
Owner: pi-tools-and-skills GM

## Order and gates

1. T-672 security hardening — narrow redaction/confirmation slice first; Navigator/security review required.
2. T-666 pi-doctor — read-only diagnostics MVP; Navigator review for tool/command contract.
3. T-667 Panopticon reliability/status — status/snapshot/digest observability before restart semantics; review if API/persistence changes.
4. T-668 teams/council resilience/status — manifest/status surface before resumable runs; review for persistence/API changes.
5. T-669 kanban helpers — dependencies/next/templates/JSON export in small slices.
6. T-670 scheduler — preview/history/overlap/templates in local CoAS scope.
7. T-671 TUI/accessibility — searchable/grouped/confirm/help/non-colour improvements where targeted.

## Per-ticket completion evidence

- Targeted tests plus `npm run check` and `npm test` when practical before commit.
- `git diff --check` before commit.
- Bounded secret scan for touched files and automation/session-adjacent paths.
- Navigator/council disposition recorded when architecture/security/persistence/API semantics change.
- Report `DONE <id>` or `BLOCKED <id>` with artifacts, checks, commit hash, and reviewer/ADR disposition.

## Safety boundaries

- No raw sessions, secrets, `.workers`, or unrelated repo mutation.
- Preserve compatibility; defer broad sandbox/trust/resume/restart semantics unless reviewed.
- WIP cap: 2–3 focused workers; GM owns integration quality.

## Initial claims

- Claimed T-672 first per urgent directive.
- Next planned: T-666 read-only pi-doctor MVP.

## T-668 evidence

Slice: Teams/council resilience/status observability without resume/checkpoint semantics.

Artifacts:
- `extensions/pi-panopticon/teams/team-runtime.ts`
- `tests/teams/team-tools.test.ts`
- `extensions/pi-panopticon/teams/README.md`
- `tests/architecture/hotspots.ts`

Validation:
- `npm test -- tests/teams/team-tools.test.ts` passed.
- `npm run check` passed; Biome emitted one pre-existing informational template-literal suggestion in `tests/goal/pi-goal-tools.test.ts`.
- `npm test` passed: 86 files, 749 tests.
- `git diff --check` passed.
- Bounded touched-file secret scan passed.

Review/ADR disposition:
- Navigator run `team-mq8m719b-7a1510a0` completed before commit prep with no blocking follow-up observed.
- ADR disposition: no new ADR planned; this is an additive status-surface change with no persistence schema or protocol semantics change.
- Privacy disposition: aggregate counts only; no raw prompts, transcripts, logs, model output, or error bodies in summary.

## T-667 evidence

Slice: Panopticon reliability/status observability without restart/resume semantics.

Artifacts:
- `extensions/pi-panopticon/registry/health.ts`
- `tests/panopticon/health.test.ts`
- `extensions/pi-panopticon/README.md`
- `tests/architecture/hotspots.ts`

Validation:
- `npm test -- tests/panopticon/health.test.ts` passed.
- `npm run check` passed; Biome emitted one pre-existing informational template-literal suggestion in `tests/goal/pi-goal-tools.test.ts`.
- `npm test` passed: 86 files, 746 tests.
- `git diff --check` passed.
- Bounded touched-file secret scan passed.

Review disposition:
- Navigator run `team-mq8lsyeu-f3b95844` approved. Follow-up patch added zero-agent summary and header/agent-shape compatibility tests.
- Privacy disposition: aggregate counts only; no new raw logs, transcript text, paths beyond existing per-agent socket field, or persistence.

## T-666 evidence

Slice: read-only `pi-doctor` diagnostics MVP.

Artifacts:
- `extensions/pi-doctor/index.ts`
- `extensions/pi-doctor/doctor.ts`
- `extensions/pi-doctor/package.json`
- `extensions/pi-doctor/README.md`
- `tests/pi-doctor-doctor.test.ts`
- `docs/architecture.md`

Validation:
- `npm test -- tests/pi-doctor-doctor.test.ts tests/architecture.test.ts` passed after adding module comments.
- `npm test -- tests/pi-doctor-doctor.test.ts tests/shared/test-quality.test.ts` passed after adding README and direct test filename.
- `npm run check` passed; Biome emitted one pre-existing informational template-literal suggestion in `tests/goal/pi-goal-tools.test.ts`.
- `npm test` passed: 86 files, 745 tests.
- `git diff --check` passed.
- Bounded touched-file secret scan passed.

Review disposition:
- Navigator run `team-mq8le2rk-81b8643b` approved the MVP. Follow-up patch added duplicate tool-name namespace diagnostics/tests per review note.

## T-672 evidence

Slice: display-only secret redaction for Panopticon session-log previews.

Artifacts:
- `lib/secret-redaction.ts`
- `lib/session-log.ts`
- `tests/panopticon/registry.test.ts`
- `tests/architecture/lib-layering.ts`
- `docs/architecture.md`

Validation:
- `npm test -- tests/panopticon/registry.test.ts tests/architecture.test.ts` passed.
- `git diff --check` passed.
- Bounded touched-file secret scan passed after replacing literal fake secret fixtures with constructed example values.
- `npm run check` passed; Biome emitted one pre-existing informational template-literal suggestion in `tests/goal/pi-goal-tools.test.ts`.
- `npm test` passed: 84 files, 739 tests.

Review disposition:
- Navigator run `team-mq8gwm37-b82fbed7` conditionally approved. Follow-up patch added direct helper coverage for non-mutation, mixed-case keys/headers, JSON-ish authorization, nested tool args, and redact-before-truncate behavior.
