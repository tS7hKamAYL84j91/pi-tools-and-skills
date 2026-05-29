# T-318 pi-teams Result/State/Detail Surface Audit

Date: 2026-05-29
State: hardening slice — docs and regression tests only

## Summary

T-318 audits the current pi-teams run result, persisted state, node detail, run detail, and observability surfaces. The change adds regression tests for current shape and additive compatibility without changing public CLI/API contracts, runtime behavior, checkpoint/resume semantics, approval semantics, provider integration, or storage format.

Artifacts:

- `tests/team-state.test.ts` — pins persisted event keys, reduced record keys, and additive-event tolerance.
- `tests/team-observability.test.ts` — pins observability detail projection shape.
- `tests/team-node-runner.test.ts` — pins compact node detail/error shape.

## Surface inventory

| Surface | Location | Version marker | Classification | Notes |
|---|---|---:|---|---|
| Session custom event envelope | `extensions/pi-teams/state.ts` / `TEAM_RUN_CUSTOM_TYPE` | `schemaVersion: 1` | stable internal diagnostic | Stored as `customType: "pi-teams:run"`; used by `team_runs` and overlays. Not a durable resume/replay contract per ADR 018. |
| Reduced run record | `TeamRunRecord` in `extensions/pi-teams/types.ts` | `version: 1` | stable internal diagnostic | Returned by `team_runs` details and local UI. Not a public storage API. |
| Node completion event integrity fields | `TeamRunNodeCompletedEvent` | event schema v1 | stable internal diagnostic | `output`, `outputChars`, `outputSha256`, `outputTruncated`; output is bounded to 64,000 chars. |
| Reduced node record | `TeamRunNodeRecord` | run record v1 | stable compact ledger | `phaseId`, `nodeId`, `role`, `model`, `ok`, `durationMs`, `output`, optional `error`. |
| Handler result details | `TeamHandlerResult.details` / tool result details | none | runtime result, internal shape | Includes protocol-specific fields such as `team`, `ok`, `nodes`, `maxLoops`, `stopped`, `reason`; not persisted as-is. |
| Node detail result | `nodeDetails(...)` | none | stable compact runtime detail | Emits `role`, `model`, `ok`, `durationMs`, `attempts`, optional `error`; intentionally excludes prompt bodies, output, binding config, tools, and parameters. |
| Run detail event | `TeamRunDetailEvent` | event schema v1 | experimental detail payload | `detailKind`, optional phase/node ids, `message`, optional `data`, `artifactUri`, `error`. Detail kind vocabulary is constrained to `trace`, `handoff`, `fallback`, `artifact`, `error`. |
| Reduced run detail record | `TeamRunDetailRecord` | run record v1 | experimental detail payload | `kind`, optional phase/node ids, `message`, optional `data`, `artifactUri`, `error`, `timestamp`. |
| Observability event | `TeamObservabilityEvent` | `schemaVersion: 1` | provisional mapper | Maps lifecycle/detail/approval/error events for local review/tests. Not a durable external API per T-309. |
| Approval trace data | `approval-gates.ts` via `run_detail.data` | approval schema v1 | provisional/default-disabled | Must not become mandatory policy input without ADR/review. |

## Persisted event fields

Current event kinds and fields:

- `run_started`: `schemaVersion`, `kind`, `runId`, `seq`, `timestamp`, `orchestratorPid`, `teamId`, `protocol`, `input`, optional `participants`.
- `phase_started`: base event fields plus `phaseId`, `label`.
- `node_completed`: base event fields plus `phaseId`, `nodeId`, `role`, `model`, `ok`, `durationMs`, `output`, `outputChars`, `outputSha256`, `outputTruncated`, optional `error`.
- `run_detail`: base event fields plus `detailKind`, `message`, optional `phaseId`, `nodeId`, `data`, `artifactUri`, `error`.
- `stop_requested`: base event fields plus `reason`.
- `run_stopped`: base event fields plus `ok: false`, `durationMs`, `reason`, optional `summary`.
- `run_completed`: base event fields plus `ok: true`, `durationMs`, optional `summary`.
- `run_failed`: base event fields plus `ok: false`, `error`.
- `run_tombstoned`: base event fields plus `reason`.

Additive compatibility policy tested in this slice: unknown extra fields on known events and unknown future event kinds are tolerated during reduction and ignored by current `TeamStateManager` logic.

## Growth and leakage review

Guarded today:

- Node output persisted via `recordNodeCompleted()` is bounded by `MAX_PERSISTED_OUTPUT_CHARS = 64_000` and includes integrity metadata.
- `nodeDetails()` excludes prompts, outputs, tools, provider parameters, and full binding objects.
- `participantsFromRuns()` intentionally carries model outputs for final synthesis packaging, but prompt/system prompt fields are blanked for direct node-run results.

Not yet bounded:

- `recordDetail()` persists `message`, `data`, `artifactUri`, and `error` verbatim.
- Observability projection forwards detail `data` and `error` verbatim.
- Handler result `details` objects are runtime tool responses and can include protocol-specific arrays/objects.

Disposition: leave unbounded detail fields unchanged in this slice to avoid silently changing diagnostic and approval-gate semantics. If detail payloads become externally consumed or long-lived, add an ADR-backed detail budget with truncation metadata matching the node-output pattern.

## ADR / review disposition

No new ADR is required for this T-318 slice because it adds documentation and regression tests only. It does not introduce a new public surface, change a version marker, change persisted schema semantics, or wire observability into an external sink. ADR 018 remains the controlling boundary for team-run state detail.
