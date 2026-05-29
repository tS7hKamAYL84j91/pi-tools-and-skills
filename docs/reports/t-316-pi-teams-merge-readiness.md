# T-316 pi-teams Merge Readiness Review

Date: 2026-05-29
Conclusion: **merge-ready with follow-ups**

## Reviewed scope

This review covers the current `main` state after recent pi-teams hardening slices: T-310, T-311, T-312, T-318, T-319, and the related config/model-validation and fallback hardening covered by current tests.

Reviewed artifacts and code paths:

- Runtime/config: `extensions/pi-teams/team-manifest.ts`, `team-registry.ts`, `team-node-runner.ts`, `team-handlers.ts`, `handoff.ts`, `state.ts`, `observability.ts`, `worktree-isolation.ts`.
- Tests: `tests/team-registry.test.ts`, `team-members.test.ts`, `team-node-runtime-fallback.test.ts`, `team-node-runner.test.ts`, `team-state.test.ts`, `team-observability.test.ts`, `team-handoff.test.ts`, `team-research-stop.test.ts`, `team-worktree-isolation.test.ts`, `team-provider-payload.test.ts`, `team-runner-cancel.test.ts`, `team-graph.test.ts`.
- Docs/ADRs/reports: ADR 018, ADR 021, T-310, T-318, T-319, T-308/T-309, recurring SOP template docs, and `extensions/pi-teams/README.md`.

## Integration findings

| Area | Finding | Merge impact |
|---|---|---|
| Config/model validation | Manifest validation enforces schema v2, non-empty required metadata, `provider/model` syntax for model ids, approval metadata shape, prompt/model-slot uniqueness, and positive model-slot counts. Registry warns rather than hard-failing on unavailable live agents and legacy graph fields. | Acceptable. Validation is intentionally shallow and does not perform provider discovery. |
| Runtime fallback behavior | `runTeamNode()` keeps retry fallback bounded by `maxRetries`, preserves final node errors, reports attempts, and disables retry/model fallback for live-agent refs. | Merge-ready. |
| Result/state/detail surfaces | Team run events remain session-scoped `schemaVersion: 1`; reduced run records remain `version: 1`; node output is bounded and hash-addressed; node details stay compact. T-318 pins current shapes and additive compatibility. | Merge-ready under ADR 018 internal-diagnostic boundary. |
| Handoff schema / routing | T-319 introduced explicit internal node-target handoff validation, allow-list target resolution, runtime routability checks, circular detection, partial-failure reporting, and valid-path regression tests. Terminal non-routable research handoff details are no longer emitted. | Merge-ready; fixes invalid detail emission without changing valid handoff shape. |
| Observability | T-309/T-318 observability remains a provisional mapper over existing run events; tests cover lifecycle/detail/approval/error mapping and serialization validation. | Merge-ready if kept non-public/non-durable. ADR required before external/public use. |
| Checkpoint/resume | ADR 021 defines a future design only. No checkpoint writer, reader, `team_resume`, durable artifact store, or resume policy was added. | Merge-ready; boundaries respected. |
| Recurring SOP/template guidance | T-311 adds static Markdown SOPs and README/docs links only; no scheduler, runtime command, template engine, or mandatory gate was added. | Merge-ready. |
| Worktree isolation | T-310 helper is internal/experimental, opt-in, and not wired into `team_run`, tools, commands, public config, or persistent state. Tests cover planning, allocation, cleanup, dirty-main guard, locks, and conflict reporting. | Merge-ready with runtime-promotion follow-ups before use. |
| Legacy graph/runtime routing | Generic graph execution remains unsupported; registry preserves legacy manifests with warnings and direct handlers reject unsupported graph execution. | Merge-ready; no hidden graph runtime contract. |

## Recommendation

Proceed with merge/release of the current pi-teams state as **merge-ready with follow-ups**.

No merge-blocking defect was found. The remaining risks are explicitly documented boundary items rather than integration failures:

1. **Do not promote observability/run-detail/checkpoint surfaces without ADR.** ADR 018 and ADR 021 remain controlling.
2. **Do not wire worktree isolation into runtime until T-310 follow-ups are designed and approved**, especially branch ownership, cleanup safety, approval gates, stale lock cleanup, and merge/report-only workflow.
3. **Keep model validation syntax-only unless a follow-up explicitly approves provider/model availability discovery.** Runtime provider availability remains a runtime concern.
4. **Add a detail payload budget before externalizing run details.** `recordDetail().data`, `message`, `artifactUri`, and `error` remain unbounded internal diagnostic fields.
5. **Expand handoff target types only through a new narrow design.** Current allowed target type is internal `node` only.

## ADR disposition

No new ADR is required for this merge-readiness review. The reviewed changes either enforce existing boundaries or add internal helpers/tests/docs. ADR/reviewer approval is required before public/durable schema promotion, checkpoint/runtime resume, approval-policy promotion, external observability export, provider/live-network integration, or default runtime worktree isolation.

## Verification

Completed before writing this report:

- `npm run test -- --run tests/team-registry.test.ts tests/team-members.test.ts tests/team-node-runtime-fallback.test.ts tests/team-node-runner.test.ts tests/team-state.test.ts tests/team-observability.test.ts tests/team-handoff.test.ts tests/team-research-stop.test.ts tests/team-worktree-isolation.test.ts tests/team-provider-payload.test.ts tests/team-runner-cancel.test.ts tests/team-graph.test.ts` — PASS, 12 files / 113 tests.

Final quality-gate results are recorded in the T-316 completion report after this artifact is committed.
