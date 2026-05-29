# ADR 024: pi-teams Observability JSONL Disposition

Status: Proposed
Date: 2026-05-29
Ticket: T-499

## Context

T-309 added `extensions/pi-teams/observability.ts`, a mapper from internal `TeamRunEvent` records to newline-serializable `TeamObservabilityEvent` objects. T-318 later pinned current detail projection and additive compatibility in tests. T-316 concluded pi-teams is merge-ready only if observability remains non-public/non-durable. T-498/ADR 023 quarantined approval gates and explicitly kept approval observability provisional.

Current production surface:

- `TEAM_OBSERVABILITY_SCHEMA_VERSION = 1`.
- `observabilityEventsFromRunEvents(events)` maps in-memory/session team events to observability objects.
- `serializeObservabilityEvents(events)` validates a small set of required fields and returns JSONL text.
- Tests cover lifecycle, fallback/handoff/artifact details, approval mapping, node errors, failed outcomes, and serialization rejection for invalid events.

The code exports types and helpers, so it can look more stable than intended. However, no current tool, command, UI, runtime writer, external sink, persistence store, dashboard, checkpoint reader, or public API consumes the JSONL as a durable contract.

Relevant boundaries:

- ADR 018 treats team run state/details as internal session-scoped diagnostics and forbids treating T-309 observability JSONL as public/durable without follow-up approval.
- ADR 021 says observability is not a resume source and any checkpoint/resume promotion requires a separate approved contract.
- ADR 023 says approval observability remains provisional and approval traces are not authorization evidence.

## Decision

Keep pi-teams observability JSONL **internal/provisional**. Do not promote it to a public API, durable schema, plugin contract, audit log, compliance record, checkpoint/resume source, approval-policy input, or external telemetry format.

The current mapper and tests may remain as internal safety rails because they make diagnostics more structured and catch accidental shape drift. Future work may use the mapper for local tests, synthetic fixtures, and reviewed internal reports. Any real persistence, UI/tool exposure, external export, or contract promise requires a new approved promotion ADR.

This is not a full quarantine of the code: the mapper can remain available to internal code. The quarantine applies to **contract interpretation**: callers must not treat the JSONL shape as stable outside this repo-local diagnostic context.

## Current field and event inventory

Classification terms:

- **Stable internal** — useful internal diagnostic shape; additive changes should be intentional and tested.
- **Provisional** — may change before any public/durable use.
- **Experimental detail** — forwarded from `run_detail` and not bounded/redacted enough for external use.

| Field/event | Classification | Notes |
|---|---|---|
| `schemaVersion: 1` | stable internal | Version marker for current mapper only; not a public compatibility promise. |
| `kind` | stable internal | Current values: `run_started`, `run_stopped`, `run_completed`, `run_failed`, `approval_required`, `approval_result`, `artifact`, `error`, `handoff`, `fallback`, `trace`. |
| `runId`, `timestamp`, `message` | stable internal | Required by serializer. `message` may contain diagnostic text and must not be externally exported without redaction/bounds. |
| `teamId`, `protocol`, `phaseId`, `nodeId` | stable internal | Useful for local timelines; not sufficient for durable lineage or resume. |
| `ok`, `status`, `durationMs` | stable internal | Local outcome/timing hints; not billing, SLA, or compliance data. |
| `artifactUri` | provisional | Claim-check text only; no dereference/storage policy is approved. |
| `error` | experimental detail | May contain provider/runtime text and needs redaction before external exposure. |
| `data` | experimental detail | Forwarded from `run_detail.data`; may be arbitrary diagnostic metadata and is not size-capped or schema-stable. |
| approval-derived kinds | provisional | Mirror ADR 023 quarantined approval traces; not authorization evidence. |
| `run_started.data.promptChars` | provisional | Count only, but still derived from prompt input. Future public use should decide whether even metadata counts are allowed. |
| `run_stopped.data.reason` | experimental detail | Reason text can include operator/runtime context. |

## Secret, PII, and retention risks

Current risks are acceptable only for local/internal diagnostics:

- `run_detail.data` is forwarded verbatim into observability events.
- `message`, `error`, and `reason` text can include model/provider/tool/runtime text.
- `artifactUri` may reveal local task/report/session structure even when it does not embed content.
- Approval observability can expose owner/source/reason strings from ADR 023 provisional gates.
- No JSONL retention, deletion, redaction, access-control, or cross-agent visibility policy exists.
- The serializer validates shape but does not redact, truncate, classify sensitivity, or enforce byte budgets.

Therefore observability JSONL must not be committed, shared, exported, sent to providers, used in dashboards, or exposed cross-agent unless the producing data is synthetic/redacted or a future promotion ADR approves the full data policy.

## Non-goals

This ADR does not:

- change runtime event formats, field names, versions, or serializer behavior;
- add or remove tools, commands, UI, dashboards, writers, readers, or persistence;
- define a public schema or compatibility guarantee;
- approve external telemetry or provider/network export;
- approve checkpoint/resume, audit/compliance, billing, approval-policy, or authorization use;
- change Principal/Gravitas approval status.

## Future promotion path

Promotion is possible only after a concrete consumer exists. Valid candidate consumers might include a local-only debug artifact, a read-only team timeline view, or a synthetic checkpoint-fixture generator. Each candidate must choose exactly which fields are allowed and how they are bounded.

A promotion ADR must define:

- intended consumer and non-consumers;
- public vs internal schema status;
- complete field allow-list and event vocabulary;
- redaction and truncation rules for `message`, `error`, `data`, and `artifactUri`;
- maximum event size, JSONL file size, and retention/deletion policy;
- allowed storage location and access boundary;
- compatibility/versioning/migration rules;
- handling for unknown event kinds and additive fields;
- whether claim-checks may be dereferenced, and by whom;
- explicit prohibition or approval for approval-policy, resume, audit, billing, or external telemetry use;
- rollback plan.

## Required tests before any promotion

Before any public/durable/runtime promotion, add tests that cover:

- redaction of credential-looking values in `message`, `error`, `data`, and claim-check strings;
- event and file byte caps with truncation metadata;
- unknown/new event kinds and additive fields;
- unsupported schema versions;
- malformed JSONL lines if a reader is introduced;
- missing/stale artifact claim-check behavior;
- approval events remaining non-authoritative unless a separate approval-policy ADR says otherwise;
- no-network/no-provider/no-real-session fixtures.

## Rollback and compatibility

Current rollback is to stop calling `observabilityEventsFromRunEvents()` or `serializeObservabilityEvents()` outside tests/internal diagnostics. No migration is required because there is no approved durable store.

If internal event shapes change, update tests and docs in the same change. If future public promotion occurs, keep current v1 JSONL as legacy internal diagnostic format unless an explicit migration plan says otherwise.

## Recommendation

Proceed with **internal/provisional** disposition. Keep the mapper and tests, keep examples explicitly non-binding, and require Gravitas/Principal approval plus reviewer/council PASS and a promotion ADR before any public/durable/runtime observability JSONL contract.
