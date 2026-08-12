# T-823 — spawn-don't-await + run-once-catch-up for pi-coas scheduler

## Goal
Adopt OpenWorker's two highest-leverage scheduler patterns in `extensions/pi-coas/`:
1. **spawn-don't-await**: each scheduled run becomes an independent spawned async task so a run suspended on `awaiting-approval` does not delay sibling due-runs. Concurrency manifests in scheduler snapshots.
2. **run-once-catch-up**: on scheduler startup, fire missed scheduled runs since the last check before resuming the regular tick loop.

## Background
The current `CoasInternalScheduler.tick()` fires due schedules synchronously. A parked `awaiting-approval` run stalls the loop until it resolves. OpenWorker's `coworker/automation/scheduler.py` uses `asyncio.create_task(self.run_task(...))` and a first `trigger="catchup"` pass to avoid both stalls and silent misses.

## Approach (test-first)
The previous T-810 attempt used `setTimeout(0)` inside `tick()` and created microtask races with the synchronous `sendUserMessage` mock. This implementation instead:
- Uses a `Promise.resolve().then(...)` task queue inside `CoasInternalScheduler` that is flushed explicitly via `flush()`.
- `tick()` schedules due runs into the queue and returns immediately.
- `flush()` drains the queue and awaits in-flight spawns.
- `start()` performs a one-time `catchup` pass before the interval loop.
- Tests use `flush()` deterministically instead of relying on real timers.

## Files to change
- `extensions/pi-coas/types.ts` — extend `SchedulerSnapshot` with `spawnedRuns`.
- `extensions/pi-coas/scheduler.ts` — task queue, `flush()`, catchup pass in `start()`, spawn-don't-await in `tick()`.
- `extensions/pi-coas/scheduler-run-once.ts` — expose a spawn-friendly entry point that returns a promise the queue can await.
- `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts` — unskip and verify behavior.
- `briefs/2026-08-05-impl-t823-spawn-catchup.md` — this brief.

## Acceptance gates
- [ ] A schedule that parks on `awaiting-approval` does not prevent another due schedule from firing in the same tick.
- [ ] `snapshot()` reports the number of in-flight spawned runs.
- [ ] `start()` runs a catchup pass that fires missed schedules since last check.
- [ ] Existing scheduler/delivery/approval tests still pass.
- [ ] `npm run check` clean.
- [ ] Architecture tests green.

## Review plan
Council/ADR review before closing.
