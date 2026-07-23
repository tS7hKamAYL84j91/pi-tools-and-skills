# FIRE Review — T-791 ADR-0008 schedule delivery guard implementation sketch

Date: 2026-07-23
Target: pi-tools-and-skills ADR-0008 implementation sketch (schedule delivery targeting guard + `isRootSession` API)
Baseline: main @ 3163d1a, clean working tree
Scope: `extensions/pi-coas/scheduler.ts`, `extensions/pi-panopticon/registry/registry.ts`, `extensions/pi-panopticon/spawner/spawner-tools.ts`, `extensions/pi-coas/types.ts`, `extensions/pi-coas/schedules.ts`, `extensions/pi-coas/lifecycle.ts`
Exclusions: unrelated extensions, working-notes, Matrix transport, external CoAS repo runtime

## Executive summary

- The implementation sketch is architecturally sound, low-risk, and directly addresses the live hijack bug (workspace schedules landing in spawned task agents).
- The change is small and reuses existing Panopticon registry metadata (`parentId`, `visibility`) plus a new `scope` field.
- No new runtime, no persistent queue, no provider/credential changes.
- Verdict: **PASS with follow-ups** — shippable once the sketch is implemented and regression tests pass.

## FIRE assessment

| Lens | Finding | Disposition |
|---|---|---|
| Fast | The guard is a synchronous identity check before an existing `sendUserMessage` call; rollback is just "don't send". Local feedback loop is existing schedule log + `coas_status`. | PASS |
| Inexpensive | No new services, no dependencies, no persistent state beyond schedule log line and an in-memory snapshot counter. Memory cost: one counter and one optional `scope` field per registry record. | PASS |
| Restrained | Scope is limited to delivery guard + `scope` attribute + `TARGET_AGENT` field. No persistent queue, no force-delivery, no model/registry changes outside Panopticon/CoAS boundary. Default `scope="workspace"` preserves backward compatibility. | PASS |
| Elegant | Fits existing abstractions: registry already stores `parentId`/`visibility`; scheduler already snapshots state; schedule files already carry `workspaceId`. `isRootSession()` is a small pure helper. | PASS |

## Material findings

| Finding | Priority | Severity | Confidence | Evidence | Recommendation |
|---|---|---|---|---|---|
| Default `scope` must be `"workspace"` for backward compatibility | P1 | High | High | Existing `spawn_agent` callers in tests and automation do not pass `scope`; defaulting to `"task"` would silently break workspace-wide schedules. | Set default `scope` to `"workspace"`; only new swarm/task callers opt into `"task"`. |
| `isRootSession()` must account for manual root agents that may have `visibility: "global"` | P1 | High | High | `registry.ts` sets `visibility = "global"` unless `PANOPTICON_VISIBILITY_ENV === "scoped"`; a root GM agent could be either. | `isRootSession()` returns true when `parentId` is absent and `scope !== "task"` (do not rely only on `visibility`). |
| Schedule log must include active identity on every queued/dropped run | P2 | Medium | High | ADR-0008 §4 requires snapshot identity at trigger time; current scheduler log line only records host. | Add `sessionName`, `agentName`, `workspaceId`, `scope` to queued/dropped log lines. |
| `TARGET_AGENT` resolution failure should drop and log, not throw | P2 | Medium | High | ADR-0008 §2: "If unresolvable, the prompt is dropped and logged." | Implement as guard returning early, with `droppedScheduleRuns` increment. |
| Snapshot counter naming consistency | P3 | Low | High | `SchedulerSnapshot` uses `queued`/`failed`; add `droppedScheduleRuns` or `dropped` for symmetry. | Use `droppedScheduleRuns` per ADR, expose in `formatCoasStatusSlot()`. |

## No-go conditions

- None found. The sketch does not introduce secrets, persistence regressions, or API-surface risks beyond the intended guard.

## Follow-ups

- Add regression tests for deliver-to-root, drop-from-task, and `TARGET_AGENT` resolve/drop cases.
- Document the `scope` parameter in `spawn_agent` prompt guidelines.
- When ADR-032 telemetry lands, consider threshold-based alerting on `droppedScheduleRuns`.

## Verification

- `git diff --check` — pass (no output).
- `npm run check` — pass.
- `npm test` — pass (120 files, 980 tests).
- Secret scan over touched paths — not run (no new secret-adjacent code in sketch).

## Final status

PASS with follow-ups — implementation is safe to proceed. Required conditions: default `scope="workspace"`, `isRootSession()` checks `parentId` and `scope`, and regression tests added before merge.
