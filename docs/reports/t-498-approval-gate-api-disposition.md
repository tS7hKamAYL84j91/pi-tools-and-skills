# T-498 pi-teams Approval Gate API Disposition

Date: 2026-05-29
Recommendation: **quarantine/internalize**

## Summary

T-498 inspected the current provisional pi-teams approval-gate API and related state/detail/observability boundaries. The recommendation is to keep the small tested POC, but quarantine it as internal/provisional decision-support plumbing until a real workflow has explicit Gravitas/Principal approval and an ADR-backed promotion plan.

Decision artifact:

- `docs/adr/023-pi-teams-approval-gate-quarantine.md`

## Reviewed surfaces

- `extensions/pi-teams/approval-gates.ts`
- `extensions/pi-teams/team-types.ts` (`TeamApprovalConfig`)
- `extensions/pi-teams/team-manifest.ts` approval config validation
- `extensions/pi-teams/observability.ts` approval mapping
- `tests/team-approval-gates.test.ts`
- `tests/team-manifest-validation.test.ts`
- `docs/reports/t-308-pi-teams-approval-gates.md`
- `docs/reports/t-494-clean-architecture-kiss-yagni-dry-review.md`
- `docs/adr/018-team-run-state-detail-boundary.md`
- `docs/adr/021-pi-teams-checkpoint-resume-design.md`

## Rationale

Promotion is premature because the repo has not approved identity, retention, artifact, UI, notification, mutating-action, checkpoint/resume, or audit semantics. Deleting the POC is unnecessary because it is small, fail-closed, tested, and useful for future workflow design.

The safe path is quarantine:

- approval helpers stay default-disabled and unwired from normal `team_run` runtime;
- approval request/result details remain diagnostic `run_detail` trace data;
- observability remains provisional local mapping;
- no public/durable API, CLI, tool, provider, notification, or mutating authorization behavior is promoted.

## ADR / gate disposition

ADR 023 is proposed as the decision record for this disposition. It does not approve real workflow integration. Future promotion still requires Gravitas/Principal approval plus reviewer/council PASS and a promotion ADR covering actor identity, gated actions, artifact retention/redaction, failure behavior, retry/resume/worktree interactions, UX, rollback, and tests.
