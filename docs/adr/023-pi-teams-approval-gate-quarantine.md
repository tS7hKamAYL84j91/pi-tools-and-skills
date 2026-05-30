# ADR 023: pi-teams Approval Gate API Quarantine

Status: Proposed
Date: 2026-05-29
Ticket: T-498

## Context

T-308 added provisional pi-teams approval-gate primitives in `extensions/pi-panopticon/teams/approval-gates.ts`, tests in `tests/team-approval-gates.test.ts`, and observability mapping for approval request/result details. The API can create an awaiting-approval state, emit `run_detail` trace records, resolve a result, and execute a caller-provided action only after an approved state.

The current implementation is intentionally not wired into default team runtime, mutating tool authorization, live notifications, external services, or organization-wide policy. `TeamApprovalConfig` exists in team manifests and validation requires an owner only when `approval.enabled === true`, but no team protocol currently treats that config as mandatory runtime policy.

Related boundaries:

- ADR 018 allows provisional approval trace data inside session-scoped run details, but forbids using run details as mandatory approval policy inputs without follow-up ADR/design approval.
- ADR 021 says resumed runs must fail closed on missing/malformed/expired/mismatched approval data and must not infer authorization from diagnostic `run_detail` text alone.
- T-309 observability maps approval details into provisional local observability events, but is not a durable public API.
- T-494 identified approval gates as a YAGNI/API-clarity risk: production exports can look like supported runtime policy before real workflow integration.

## Decision

Quarantine the current approval-gate API as **internal/provisional decision-support plumbing**. Do not promote it to a public API, durable schema, mandatory runtime authorization layer, or mutating-tool gate yet.

The current code may remain because it is small, tested, fail-closed, and useful for future workflow design. However, future callers must treat it as an internal helper for synthetic/local experiments until a concrete workflow receives approval.

This means:

- Keep `approval-gates.ts` and `TeamApprovalConfig` default-disabled and unwired from normal `team_run` execution.
- Keep approval request/result records as diagnostic `run_detail` trace data only.
- Keep T-309 approval observability as provisional display/test mapping only.
- Do not document the helpers as user-facing extension API or stable plugin contract.
- Do not use approval traces alone as authorization evidence.

## Rationale

Promotion is premature because real workflow integration would need decisions that are not yet approved:

- who or what is allowed to approve;
- how approval identity is authenticated;
- which actions require gates;
- where approval artifacts live and how long they are retained;
- how approvals interact with retries, resume, worktree isolation, and partial failures;
- what UI/tool/notification surface operators use;
- how to audit or revoke approval decisions;
- how to avoid leaking private context in `details[].data`.

Deleting the POC is also unnecessary. The existing tests capture useful fail-closed semantics and observability behavior. Quarantine preserves that learning while preventing accidental contract promotion.

## Non-goals

This ADR does not:

- implement runtime authorization or mutating-tool gating;
- enable approval behavior by default;
- add tools, commands, UI, Matrix notifications, provider calls, or external services;
- change `TeamRunEvent`, `TeamRunRecord`, `TeamApprovalRequest`, or `TeamApprovalResult` schema semantics;
- define Principal/Gravitas approval as granted;
- authorize checkpoint resume, worktree merge, production mutation, or organization-wide policy;
- change public CLI/API contracts.

## Audit expectations while quarantined

Quarantined approval traces are local diagnostics only. They should be auditable enough for tests and operator review, but not compliance records.

Expected today:

- `requestTeamApproval()` records `approval: "required"`, gate id, risk, owner, source, reason, and optional expiry/artifact URI in `run_detail`.
- `resolveTeamApproval()` records approved/rejected/expired status with decision metadata.
- `executeAfterApproval()` fails closed and records a stopped run when approval is missing, rejected, expired, or mismatched.
- Observability can surface `approval_required`, `approval_result`, and stopped `requires_approval` events.

Not guaranteed today:

- durable retention;
- identity proof beyond supplied strings;
- artifact integrity;
- redaction beyond current internal detail boundaries;
- cross-agent consistency;
- external audit/compliance suitability;
- replay/resume safety.

## Implementation options for future approval

A future real workflow should choose one of these paths explicitly:

1. **Keep quarantined** — no runtime integration; use only synthetic tests and design docs.
2. **Internal workflow pilot** — wire gates into one named, non-default workflow with explicit owner, fake/synthetic tests, no external notifications, and local-only artifacts.
3. **Runtime mutating-action gate** — add a narrow gate around specific mutating team actions with authenticated operator approval, artifact claim-checks, rollback plan, and reviewer/council approval.
4. **Public/stable approval API** — only after a new ADR defines schema compatibility, UI/tool contract, identity, retention, redaction, audit, migration, and deprecation policy.

## Promotion gates

Require Gravitas/Principal approval plus reviewer or council PASS before any future work that:

- wires approval gates into default `team_run` execution;
- uses approvals to authorize mutating tools, worktree merges, provider calls, external notifications, or checkpoint resume;
- persists approval data outside pi session custom events;
- treats T-309 observability or `run_detail` details as durable/public approval records;
- expands `details[].data` with raw logs, prompts, private payloads, or secrets;
- adds Matrix/mailbox/human notification loops;
- changes approval identity semantics, expiry semantics, or result status vocabulary;
- exposes approval helpers as public tools, CLI/API, plugin contract, or documented user API.

A promotion ADR must define:

- actor/identity model and trust boundary;
- exact gated actions and risk taxonomy;
- approval request/result schema stability and migration;
- artifact claim-check storage, retention, redaction, and deletion;
- failure behavior for missing/malformed/stale/expired approvals;
- interaction with retries, cancellation, checkpoint/resume, and worktree isolation;
- operator UX and rollback path;
- test plan including fake approvals, rejected/expired/mismatched cases, and no-network/no-secret fixtures.

## Rollback and compatibility

Current rollback is to stop calling `approval-gates.ts`; existing `run_detail` records remain diagnostic history and current reducers already tolerate details as internal session state. No migration is required while the API remains quarantined.

If future promotion changes schema or behavior, migration must be additive where possible. Existing `approval: "required" | "approved" | "rejected" | "expired"` detail data should remain readable as legacy diagnostic traces, not authoritative policy records.

## Recommendation

Proceed with **quarantine/internalize**, not promotion. Keep the tested POC, keep documentation explicit that it is provisional/default-disabled, and require a new approved ADR before the first real workflow integration.
