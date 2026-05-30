# T-309 pi-teams Structured Observability POC

Date: 2026-05-22

## Summary

T-309 adds a provisional structured observability surface for pi-teams run events. It maps the existing session-first `TeamRunEvent` boundary into stable newline-serializable primitives for future gates, reviewers, dashboards, and graph/resume visualization.

Artifacts:

- `extensions/pi-panopticon/teams/observability.ts` — schema v1 primitives and mapper.
- `tests/team-observability.test.ts` — lifecycle/detail/approval/error/serialization coverage.

## Schema

Each `TeamObservabilityEvent` has:

- `schemaVersion: 1`
- `kind`: `run_started`, `run_stopped`, `run_completed`, `run_failed`, `approval_required`, `approval_result`, `artifact`, `error`, `handoff`, `fallback`, or `trace`
- `runId`
- `timestamp`
- `message`
- optional `teamId`, `protocol`, `phaseId`, `nodeId`, `ok`, `status`, `durationMs`, `artifactUri`, `error`, `data`

Example JSONL:

```jsonl
{"schemaVersion":1,"kind":"run_started","runId":"team-1","teamId":"navigator","protocol":"consult","timestamp":1700000000000,"message":"team navigator started","status":"running","data":{"promptChars":42}}
{"schemaVersion":1,"kind":"handoff","runId":"team-1","phaseId":"debate","nodeId":"synthesis","timestamp":1700000000100,"message":"debate generation and critique outputs handed to synthesis"}
{"schemaVersion":1,"kind":"approval_required","runId":"team-1","timestamp":1700000000200,"message":"human approval required","ok":false,"status":"requires_approval","data":{"approval":"required","gate":"deploy"}}
```

## Relation to existing work

- **T-317 boundary:** This POC consumes the existing `TeamRunEvent`/`run_detail` boundary and preserves fallback/handoff/artifact/error detail semantics instead of reverse-engineering rendered results.
- **T-269 CoAS structured completion:** Approval gates are represented as `approval_required` and `approval_result` with `status: "requires_approval"` for stopped-pending-approval flows, aligning with structured `requires_approval` semantics.
- **T-308 approval gates:** This schema is ready to carry approval request/result events, but does not implement a gate UI or policy engine.
- **Future graph/resume visualization:** The schema includes phase/node ids and final outcomes, enough for future timelines without adopting durable resume or graph runtime now.

## Scope limits

- No cost/usage fields are emitted because they are not safely available in the current team event boundary.
- No new persistence store is introduced; JSONL serialization is a simple artifact surface.
- This does not replace `TeamStateManager` reduction or `team_runs` output.

## ADR disposition

`adr_deferred_rationale`: ADR is deferred because this is a provisional v1 mapper over existing pi-teams session events, not a durable external observability contract or storage format. ADR becomes required before exposing this schema as a public API, persisting it outside session artifacts, driving approval policy from it, or using it for durable resume/graph visualization.
