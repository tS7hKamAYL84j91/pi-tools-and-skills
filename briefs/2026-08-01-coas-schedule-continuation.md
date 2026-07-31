# T-801 — pi-coas resumable schedule continuation

## Goal
Allow opt-in CoAS schedules to carry a durable, bounded run identity and a **single** prior-run summary across consecutive triggers, so recurring prompts restart from compacted context instead of zero while keeping the injected prompt constant-size.

## Background gap
`renderScheduledPrompt()` in `extensions/pi-coas/scheduler.ts` renders only static schedule metadata + the prompt. `ScheduleEntry`/`SchedulerSnapshot` in `types.ts` have no continuation state. `runOncePerMinute()` records `QUEUED` as a queue signal, treating queueing as the only durable event. There is no run-id, completion summary, or prior-run injection.

## In scope (this repo only)
1. Add an opt-in `continuation` flag to the file-backed schedule format (`ScheduleEntry`, `ScheduleAddInput`, `.env` file serialization in `schedules.ts`).
2. Give each delivery a durable `runId`.
3. Persist only the **single most recent** run summary in a private per-task run-state file under `COAS_HOME/schedule-runs/{taskId}.json`.
4. `renderScheduledPrompt()` loads that single most-recent completed summary, verifies claim-check artifacts exist/current, and injects a bounded compacted summary block when `continuation` is enabled.
5. Capture completion on pi's `agent_end` lifecycle event (not queueing). Track active scheduled deliveries in `CoasInternalScheduler`; when an agent turn that originated from a scheduled delivery ends, record a bounded summary and overwrite the prior run-state.
6. Load continuation state on session start (`session_start`); leave it durable on `session_shutdown`.
7. Keep the default stateless mode and the existing ADR-0008 workspace/target-agent delivery guard.
8. Update `SchedulerSnapshot` with continuation stats.
9. Refactor `scheduler.ts` into focused helpers (`scheduler-run-state.ts`, `scheduler-prompt.ts`, `scheduler-delivery.ts`, `scheduler-recovery.ts`, `scheduler-log.ts`, `scheduler-util.ts`) to keep module line budgets green.
10. Tests + `npm run check` clean.

## Out of scope
- No changes to the CoAS runtime repo (`coas/scheduler` or `coas/schedule-runs/`) — all state stays under this extension's `COAS_HOME`.
- No plan/stop-and-fix gates in pi-coas (those belong in worker briefs).
- No validation command execution by pi-coas.
- No new ADR; this is a schema-level opt-in flag, not a new tool surface authority.

## Files to change
- `extensions/pi-coas/types.ts` — add `continuation?: boolean` to `ScheduleEntry`/`ScheduleAddInput`; extend `SchedulerSnapshot`.
- `extensions/pi-coas/schedules.ts` — serialize/deserialize `CONTINUATION=1`; add helper paths for run-state file.
- `extensions/pi-coas/scheduler.ts` — core continuation logic and scheduler class.
- `extensions/pi-coas/scheduler-run-state.ts` — run-state persistence and prior-summary loading.
- `extensions/pi-coas/scheduler-prompt.ts` — prompt rendering and message extraction.
- `extensions/pi-coas/scheduler-delivery.ts` — workspace/scope/target-agent delivery guard.
- `extensions/pi-coas/scheduler-recovery.ts` — interrupted-run recovery across sessions.
- `extensions/pi-coas/scheduler-log.ts` — schedule telemetry log appender.
- `extensions/pi-coas/scheduler-util.ts` — cron matching, tick keys, run-id generation.
- `extensions/pi-coas/lifecycle.ts` — load continuation state on `session_start`; maybe wire `agent_end` hook.
- `extensions/pi-coas/tools-schedule.ts` — expose `continuation` option in `coas_schedule_add`.
- `extensions/pi-coas/README.md` — document continuation mode and run-state file.
- `tests/coas/pi-coas-scheduler-continuation.test.ts` — new regression tests.
- `tests/coas/pi-coas-scheduler-delivery-guard.test.ts` — extend to verify continuation still respects guards.

## Run-state schema (per-task, `COAS_HOME/schedule-runs/{taskId}.json`)
```json
{
  "taskId": "daily-review",
  "runId": "run-20260801-090000-abc123",
  "status": "complete",
  "startedAt": "2026-08-01T09:00:00Z",
  "completedAt": "2026-08-01T09:05:00Z",
  "summary": "Reviewed 3 pending PRs; merged 2. Remaining: T-801 dependency check.",
  "nextAction": "Re-run dependency check after T-801 lands.",
  "lastUpdatedAt": "2026-08-01T09:05:00Z"
}
```
**No history array.** Each successful capture overwrites the entire file. The token cost of the injected summary stays constant regardless of how many times the schedule has run.

## Claim-check guard before injection
Before injecting a prior-run summary, the scheduler must:
1. Verify the schedule's `continuation` flag is true.
2. Verify the run-state file exists and the most recent run has `status === "complete"`.
3. Verify the completed run is not stale beyond a threshold (7 days); if stale, inject a "prior run summary may be stale" caveat instead of the full summary.
4. Not inject an interrupted run summary.

## Completion capture on `agent_end`
- Track active scheduled run in `CoasInternalScheduler.activeScheduledRun` when `sendUserMessage` is issued.
- On `agent_end`, if an active scheduled run exists and the messages contain an assistant message, extract a bounded summary (first 500 chars of the last assistant text block or any explicit `DONE`/`BLOCKED` marker).
- Overwrite the run-state with `status="complete"`, `completedAt`, `summary`, and `nextAction`.
- Clear `activeScheduledRun`.
- If the turn is interrupted (aborted/error), mark the run as `interrupted` with the reason and do not inject the interrupted summary on the next trigger.

## Acceptance gates
1. Continuation carries context across two consecutive triggers.
2. Evidence-aware: no phantom summary injected when no completed run exists.
3. Claim-check guard: stale/missing artifacts handled.
4. **Storage-shape test**: after ≥3 consecutive triggers, only one summary exists in the run-state file (no history array/growth). `removeSchedule` deletes the run-state file.
5. **Token-bloat test**: prompting the same schedule N times keeps the injected continuation summary length constant (within small epsilon).
6. Interrupted runs are not injected as prior context.
7. Existing tests pass.
8. `npm run check` clean.
9. Architecture fitness tests pass (file-size budgets, state-boundary rules).

## Implementation status
- [x] Types and schedule file format updated.
- [x] Run-state persistence and prior-summary injection implemented.
- [x] `agent_end` capture, recovery, and interrupted-run handling wired.
- [x] `coas_schedule_add` exposes `continuation`.
- [x] README updated.
- [x] Regression tests added and passing.
- [x] Full validation: `npx vitest run` (1051 tests), `npm run check` clean, architecture tests green.

## Review plan
Standard review: Navigator + council. No fresh ADR. Council returned **APPROVED_WITH_CHANGES**; ADR-032 amended to carve out an opt-in continuation exception. Implementation reflects the amended review feedback.