# T-810 — spawn-don't-await + run-once-catch-up for pi-coas scheduler

## Goal
Adopt OpenWorker's two highest-leverage scheduler patterns in `extensions/pi-coas/`:
1. **spawn-don't-await**: each scheduled run becomes an independent spawned task so a run suspended on `awaiting-approval` does not delay sibling due-runs. Concurrency manifests in scheduler snapshots.
2. **run-once-catch-up**: on scheduler startup, fire missed scheduled runs since the last check before resuming the regular tick loop.

## Background
The current `CoasInternalScheduler.tick()` fires due schedules synchronously. A parked `awaiting-approval` run stalls the loop until it resolves. OpenWorker's `coworker/automation/scheduler.py` uses `asyncio.create_task(self.run_task(...))` and a first `trigger="catchup"` pass to avoid both stalls and silent misses.

## In scope
- Add a lightweight task/spawn registry inside `CoasInternalScheduler`.
- `tick()` spawns due runs as independent async tasks and returns immediately.
- A run that parks on `awaiting-approval` is still tracked but does not block the next schedule.
- `snapshot()` exposes active spawned run count and awaiting-approval count.
- On `start()`, run a one-time `catchup` pass over enabled schedules: for each schedule whose last-run state is older than the current minute key, fire once.
- Keep restart-safe: existing `recoverInterruptedRuns` already handles running-state recovery.
- Preserve the per-minute deduplication (`lastRun` + `activeRuns`).
- Add tests covering:
  - sibling schedule still fires while another is awaiting approval;
  - snapshot reflects concurrent active runs;
  - startup catchup fires a missed run;
  - normal tick still deduplicates within the same minute.

## Out of scope
- Persistent multi-turn child threads (held per T-805/T-803).
- RiskClass classification (T-811).
- ADR changes (council review required, but this is behavior-preserving for existing runs; new catch-up behavior needs ADR-042 note).

## Files to change
- `extensions/pi-coas/scheduler.ts` — add spawned task tracking and catchup pass in `start()`.
- `extensions/pi-coas/scheduler-run-once.ts` — may need to expose a spawn-friendly entry point.
- `extensions/pi-coas/types.ts` — possibly extend `SchedulerSnapshot`.
- `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts` — new regression tests.
- `briefs/2026-08-04-t810-spawn-dont-await-catchup.md` — this brief.

## Acceptance gates
- [ ] A schedule that parks on `awaiting-approval` does not prevent another due schedule from firing in the same tick.
- [ ] `snapshot()` reports the number of in-flight spawned runs.
- [ ] `start()` runs a catchup pass that fires missed schedules since last check.
- [ ] Existing scheduler/delivery/approval tests still pass.
- [ ] `npm run check` clean.
- [ ] Architecture tests green.

## Review plan
Council/ADR review before closing.

## Implementation status
TBD
