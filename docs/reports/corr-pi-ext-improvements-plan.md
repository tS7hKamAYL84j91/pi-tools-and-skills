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
- Navigator run `team-mq8gwm37-b82fbed7` completed for T-672 focused security review; no blocking follow-up was delivered.
