# T-812 — T-810 recovery: test-first rewrite of spawn-don't-await + catchup

## Goal
Adopt OpenWorker's two scheduler patterns in `extensions/pi-coas/` with a deterministic, testable design:
1. **spawn-don't-await**: each scheduled run is an independent task; a parked `awaiting-approval` run never stalls sibling due-runs.
2. **run-once-catch-up**: on startup, fire missed scheduled runs for the current minute before resuming the regular tick loop.

## Why test-first
The previous T-810 attempt failed because bolting `setTimeout(0)` onto `tick()` created microtask races with the synchronous `sendUserMessage` mock. This rewrite introduces an explicit `flush()` helper and a deterministic task queue so tests can drain spawned runs before asserting.

## Files to change
- `extensions/pi-coas/scheduler.ts` — add task queue, `flush()`, catchup pass, spawn tracking.
- `extensions/pi-coas/scheduler-run-once.ts` — export `RunOnceResult` / `RunOnceContext`; keep behavior.
- `extensions/pi-coas/scheduler-approval.ts` — no change unless needed for new tests.
- `extensions/pi-coas/types.ts` — add `spawnedRuns` to `SchedulerSnapshot`.
- `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts` — new regression tests written FIRST.

## Tests to write first
1. `sibling schedule fires while another is awaiting approval`: two due schedules; first requires approval and parks; second still sends.
2. `snapshot reflects concurrent spawned runs`: slow `sendUserMessage` mock; during send, `snapshot().activeRuns` and `snapshot().spawnedRuns` are both > 0; after `flush()`, both are 0.
3. `startup catchup fires missed run`: do not call `tick()`; call `scheduler.start()` at a matching minute; expect the run to queue immediately.
4. `tick deduplicates after catchup`: catchup queues the run; immediate `tick()` at the same minute does not re-queue.
5. `spawned runs complete even if tick returns`: `await tick()` returns, but spawned promise is still in the queue; `flush()` drains it.

## Implementation notes
- Add `private taskQueue: Promise<unknown>[] = []` to `CoasInternalScheduler`.
- `runOncePerMinute()` pushes the returned promise onto `taskQueue` and returns immediately (no await in caller).
- `flush()` awaits `Promise.all(taskQueue)` and clears it.
- `tick()` spawns due runs, then returns; tests call `await scheduler.flush()` after `tick()`.
- `catchup(now)` uses the same spawn path as `tick()` but only once on startup; `lastRun` prevents re-fire.
- `snapshot()` exposes `spawnedRuns: taskQueue.length` and counts queued-but-not-flushed tasks in `activeRuns`.
- Keep `activeRuns` dedup set; track in-flight run keys separately from completed ones.

## Acceptance gates
- [ ] Tests above pass before implementation is declared done.
- [ ] Existing `tests/coas/` suite remains green.
- [ ] `npm run check` clean.
- [ ] Architecture tests green (`scheduler.ts` stays under 300 lines; if not, split further).

## Review plan
Council/ADR review before closing.

## Implementation status
TBD
