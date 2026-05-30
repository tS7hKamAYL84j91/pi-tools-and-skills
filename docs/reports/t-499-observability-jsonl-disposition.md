# T-499 pi-teams Observability JSONL Disposition

Date: 2026-05-29
Recommendation: **internal/provisional**

## Summary

T-499 reviewed the current pi-teams observability mapper, JSONL serializer, tests, and related ADR/report boundaries. The recommendation is to keep the mapper and tests as internal diagnostics/safety rails, but not promote the JSONL shape to a public or durable contract.

Decision artifact:

- `docs/adr/024-pi-teams-observability-jsonl-disposition.md`

## Reviewed surfaces

- `extensions/pi-panopticon/teams/observability.ts`
- `extensions/pi-panopticon/teams/state.ts` event sources
- `tests/team-observability.test.ts`
- `tests/team-approval-gates.test.ts`
- `docs/reports/t-309-pi-teams-observability.md`
- `docs/reports/t-318-pi-teams-result-state-detail-surface-audit.md`
- `docs/reports/t-316-pi-teams-merge-readiness.md`
- `docs/reports/t-498-approval-gate-api-disposition.md`
- ADR 018, ADR 021, ADR 023

## Rationale

The mapper is useful and tested, but the JSONL surface forwards fields that are not ready for external/durable use:

- `run_detail.data` is forwarded verbatim;
- `message`, `error`, and stopped `reason` text are not redacted or size-budgeted by the observability serializer;
- `artifactUri` has no approved dereference, storage, or retention policy;
- approval-derived events remain tied to ADR 023 quarantined approval traces;
- no reader, writer, dashboard, public API, retention policy, or compatibility contract exists.

The safe path is internal/provisional:

- keep the mapper and regression tests;
- use only for local/internal diagnostics, synthetic fixtures, and reviewed reports;
- require a future promotion ADR before public/durable/runtime exposure.

## ADR / gate disposition

ADR 024 is proposed as the decision record. It does not approve public JSONL, external telemetry, dashboards, durable storage, checkpoint/resume usage, approval-policy usage, or any runtime format change.

Future promotion requires Gravitas/Principal approval plus reviewer/council PASS and a promotion ADR covering consumer scope, field allow-list, redaction/truncation, size caps, retention/deletion, storage/access boundary, compatibility/migration, unknown-event handling, claim-check dereference rules, rollback, and tests.
