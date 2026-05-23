# ADR 018: pi-teams Run State and Detail Boundary

Status: Proposed

## Context

T-462 introduced/relies on pi-teams run state and `run_detail` records as the
operator-facing diagnostic surface for team execution. Current pi-teams state is
session-first: `TeamStateManager` appends `customType: "pi-teams:run"` events
with `schemaVersion: 1`, then reduces them into `TeamRunRecord` objects with
`version: 1` for `team_runs` inspection.

Related local work already depends on this boundary:

- T-269 structured result semantics established fail-closed/result-state language
  that T-308 mirrors for approvals.
- T-308 approval gates emit approval request/result information through
  `run_detail`, but remain provisional/default-disabled.
- T-309 observability maps existing run events/details into provisional
  structured observability primitives, but is not a durable public API.
- Current `team_runs`/run-detail behavior is an internal diagnostic view over the
  session event log, not a lifecycle or storage contract.

T-462 should not be promoted into supported runtime persistence, durable resume,
or public API behavior without a narrow decision on what this surface is allowed
to mean.

## Decision

The pi-teams run state/detail boundary is accepted only as an internal,
session-scoped diagnostic surface.

It may be used to:

- show current/recent run progress through `team_runs` and local overlays;
- preserve compact node completion records and bounded detail records in the pi
  session tree;
- carry local diagnostic details such as `trace`, `handoff`, `fallback`,
  `artifact`, and `error`;
- carry provisional approval trace data from T-308 while gates remain explicit
  opt-in/default-disabled;
- feed provisional T-309 observability mapping for local review and tests.

It must not be treated as:

- a durable public API or plugin contract;
- a long-term persistence database;
- a resume/replay source of truth;
- an authorization policy engine;
- a billing, audit, or compliance log;
- a raw private payload export channel;
- a compatibility promise for arbitrary third-party readers.

## Allowed persistence and exposure

Allowed:

- session custom events with `customType: "pi-teams:run"`;
- reduced in-memory/local records returned by `team_runs`;
- bounded node output with hash/truncation metadata already recorded by the state
  manager;
- claim-check pointers in `details[].artifactUri` when an artifact URI is
  already available;
- synthetic/redacted fixtures and docs.

Disallowed without a follow-up ADR/design note and approval:

- persisting run records/details outside the pi session tree as a supported store;
- treating T-309 observability JSONL as a public/durable schema;
- exposing run details to external services or model providers;
- cross-agent sharing of unredacted private detail payloads;
- using details as mandatory approval policy inputs;
- using run state for durable resume/replay or graph reconstruction;
- expanding `details[].data` into arbitrary raw logs or secrets.

## Compatibility and migration expectations

For the current internal surface, compatibility is best-effort and local:

- keep `schemaVersion: 1` and reduced record `version: 1` while possible;
- tolerate missing, malformed, or unknown detail records by ignoring them;
- add new detail kinds only after tests/docs explain reader behavior;
- keep node output bounded and hash-addressed rather than storing unbounded text;
- prefer additive fields over rewriting prior session entries.

If this boundary is promoted later, migration must define reader compatibility,
retention/deletion, redaction, schema-version upgrade rules, and a rollback path.

## Promotion gates

Council/reviewer approval and a new ADR/design note are required before any of
these changes:

- public/durable run-state or run-detail API;
- persistence outside session custom events;
- runtime resume/replay based on run state;
- mandatory approval policy driven by run details;
- external export, remote sync, dashboard, or shared artifact publication;
- third-party plugin consumption guarantees;
- storing larger or less-redacted payloads in `details[].data`.

## Risks if promoted without this boundary

- accidental public contract around provisional fields;
- hidden retention of prompts, model output, or sensitive operational details;
- brittle third-party readers depending on diagnostic internals;
- approval/security policy being inferred from incomplete trace data;
- incompatible future migration for resume, artifacts, or observability.

## Rollback and no-go conditions

Rollback for current usage is to stop emitting new nonessential details and keep
readers tolerant of missing/unknown entries. No data migration is required for the
internal diagnostic surface.

No-go for promotion if:

- redaction and retention are not specified;
- readers cannot tolerate missing or malformed events;
- details would contain raw secrets/private logs;
- approval policy depends solely on diagnostic traces;
- resume/replay cannot prove deterministic and safe behavior.

## Next action

Keep T-462 run state/detail as internal diagnostics. The next implementation
slice may improve local `team_runs` readability or tests, but must not add
durable persistence, public API guarantees, external export, or approval-policy
promotion without the promotion gates above.
