# ADR 044: Spawn-don't-await scheduled runs with startup catchup

## Status

Accepted — 2026-08-13

## Context

`extensions/pi-coas/scheduler.ts` currently runs every due schedule synchronously
inside `tickTracked()`:

```typescript
for (const schedule of schedules) {
  if (scheduleMatchesDate(schedule.cronExpr, now)) {
    await this.runOncePerMinute(schedule, minuteKey(now), now);
  }
}
```

This creates two operational problems:

1. **Head-of-line blocking.** A schedule that requires principal approval parks
   as `awaiting-approval` by writing an approval artifact and returning from
   `runOncePerMinute`. The `await` completes quickly, so the loop continues.
   However, continuation-enabled or future approval-resumed runs are delivered
   synchronously via `pi.sendUserMessage` and can block the tick while the UI
   session processes them. More importantly, any async work inside `runOncePerMinute`
   (approval checks, run-state writes, delivery) is awaited serially, so a slow
   sibling run delays later due runs in the same minute.

2. **Missed runs on startup.** If pi is closed during a scheduled minute, the
   next `tick()` only checks the current minute. Any schedule whose cron expression
   matched a minute while pi was offline is silently skipped until its next
   matching minute.

OpenWorker's scheduler solves both by spawning each run as an independent task and
by running a one-time catchup pass before the regular tick loop. We want the same
properties for CoAS schedules without introducing real-timer flakiness in tests.

## Decision

### 1. `CoasInternalScheduler` owns a task queue

Add a private array of pending promises:

```typescript
private pendingRuns: Promise<unknown>[] = [];
```

`tickTracked()` enumerates due schedules and enqueues one spawned promise per due
schedule into `pendingRuns`. It does **not** `await` individual runs. The tick
returns as soon as all runs are enqueued.

```typescript
private async tickTracked(now: Date): Promise<void> {
  // ... load and validate schedules ...
  for (const schedule of schedules) {
    if (scheduleMatchesDate(schedule.cronExpr, now)) {
      const runKey = `${schedule.taskId}:${minuteKey(now)}`;
      this.pendingRuns.push(this.spawnRun(schedule, runKey, now));
    }
  }
}
```

### 2. `flush()` drains the queue deterministically

Add a public/test-only method:

```typescript
async flush(): Promise<void> {
  while (this.pendingRuns.length > 0) {
    const batch = this.pendingRuns.splice(0, this.pendingRuns.length);
    await Promise.all(batch);
  }
}
```

Tests call `flush()` after `tick()` instead of sleeping or relying on
`setTimeout(0)`. Production code may call `flush()` opportunistically but is not
required to; `SchedulerWorkTracker` already awaits in-flight work during `stop()`.

### 3. Runs are spawned with bounded concurrency and internal error handling

`spawnRun()` wraps `runOncePerMinute()` with the same `activeRuns`/`lastRun`
bookkeeping currently in `runOncePerMinute`, but returns a promise that the queue
awaits. The existing `SchedulerWorkTracker` still tracks top-level work, so
`stop()` waits for enqueued runs to finish.

`activeRuns` (the set of per-minute run keys) prevents duplicate dispatch within
the same minute, including across overlapping ticks. `spawnedRuns` (new snapshot
field) reports in-flight spawned promises that have not yet settled.

`runOncePerMinute()` already catches its own errors and writes them to `metrics`
and the schedule log, so a spawned run never rejects unexpectedly. `flush()`
awaits every enqueued promise, ensuring no unhandled rejection escapes the
scheduler.

### 4. Snapshot exposes `spawnedRuns`

Extend `SchedulerSnapshot`:

```typescript
spawnedRuns?: number;
```

`snapshot()` returns `this.pendingRuns.length` plus any currently settling run.

### 5. `start()` runs a one-time catchup pass

Before starting the 60-second interval, `start()` computes the previous minute
key and checks whether any enabled schedule would have matched any minute since
the scheduler's last recorded check. For v1, catchup fires the **most recent**
missed matching minute per schedule, bounded to the last 24 hours, and only if
no run was recorded for that minute.

Catchup reuses `spawnRun()` so it is non-blocking and respects the same
`activeRuns`/`lastRun` deduplication. Catchup updates `lastRun` for each
schedule to the key of the fired missed minute, so the first regular `tick()`
for the current minute does not duplicate the same schedule. If the current
minute itself matches, the regular tick enqueues that run with the current
minute key, which is different from the catchup key and therefore not
suppressed.

### 6. Test determinism

The skipped test file `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts` is
unskipped and rewritten to:

- Use `flush()` after `tick()` and `start()`.
- Mock time and file-system state; no real `setTimeout` waits.
- Assert that a parked approval run does not prevent a sibling due run from
  being enqueued in the same tick.
- Assert `spawnedRuns` is non-zero during `sendUserMessage` and zero after
  `flush()`.
- Assert catchup fires a missed run exactly once.

## Consequences

- A schedule suspended on approval no longer delays sibling due schedules.
- Scheduler restart reliably fires missed runs without manual intervention.
- Snapshot gives operators visibility into in-flight concurrency.
- Tests become deterministic and fast.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Unbounded concurrency under many due schedules | Each minute enqueues at most one run per schedule; `SchedulerWorkTracker` bounds total work; `stop()` drains everything |
| Catchup storm after long downtime | Catchup limited to last 24 hours and one most-recent missed minute per schedule |
| Duplicate catchup + tick fire | Shared `lastRun`/`activeRuns` deduplication; tick checks current minute after catchup |
| Snapshot `spawnedRuns` inconsistent during `flush()` | Count read from `pendingRuns` length at call time; tests call `flush()` to quiesce |

## Related

- `extensions/pi-coas/scheduler.ts`
- `extensions/pi-coas/scheduler-run-once.ts`
- `extensions/pi-coas/types.ts`
- `tests/coas/pi-coas-scheduler-spawn-catchup.test.ts`
- ADR 042: CoAS scheduled approval resume
