# ADR 032: Ephemeral Queue-Level Telemetry for pi-coas Internal Scheduler

## Status

Accepted

## Context

The pi-coas internal scheduler injects due schedule prompts as user messages via `pi.sendUserMessage`. Once injected, the prompt becomes a normal agent turn: the scheduler cannot observe whether the agent completed the prompt, failed mid-turn, or was interrupted. There is also no long-term Panopticon metrics store suitable for scheduler counters, and the architecture fitness tests and runtime-state boundaries forbid cross-extension imports and private-state sharing.

Operators still need a coarse signal that the scheduler is doing work: how many prompts it has queued, how many injection attempts failed, and the most recent task touched. This must not become a new public tool, persistent event bus, metrics database, or cross-extension dependency.

## Decision

Telemetry for the pi-coas internal scheduler is **ephemeral and queue-level only** by default:

- The `SchedulerSnapshot` gains aggregate counters `queued` and `failed`, plus `lastQueuedAt`, `lastFailedAt`, and `lastTaskId`.
- `CoasInternalScheduler` increments these deterministically when `sendUserMessage` succeeds or fails.
- All telemetry resets when the scheduler stops (pi session closes).
- Telemetry is surfaced through existing internal channels:
  - `renderSchedulerSnapshot` compact text output.
  - `coasStatus` text output.
  - `formatCoasStatusSlot` TUI status bar.
  - Pre-existing tool-result `details` returned by `coas_schedule_list`, `coas_schedule_add`, and `coas_schedule_remove` include `scheduler: scheduler.snapshot()` and therefore also carry the telemetry fields. This is a model-visible disclosure channel, not a new one; it is bounded to the same low-sensitivity counts, timestamps, and task ids listed above.
- No new model-visible tool, command, public API, persistence file, event bus, or cross-extension import is introduced.
- No prompt content, full stack traces, or per-turn completion state is captured beyond the existing bounded `lastError` and per-task schedule log line.

### Opt-in continuation exception (T-801)

A schedule may opt into **resumable continuation** by setting `CONTINUATION=1` in its `.env` file. When enabled, the scheduler persists a single bounded, non-secret summary of the most recent completed run under `COAS_HOME/schedule-runs/{taskId}.json`. The file is overwritten on every successful capture and contains no history array. The prior summary is injected into the next scheduled prompt after a claim-check verifies the file exists, the run is complete, and the summary is not stale.

This exception is intentionally narrow:
- It applies only to schedules that explicitly opt in; default schedules remain fully ephemeral.
- Completion is captured via the `agent_end` lifecycle hook, not by treating queueing as completion.
- The persisted state is one record per task, capped in size, and removed when the schedule is removed or continuation is disabled.
- No cross-extension state, event bus, or public API is added.

The opt-in continuation feature supersedes the original "Correlated completion tracking" rejection for continuation schedules only.

## Consequences

- Users see whether the scheduler is actively queueing work and whether recent injection attempts failed, without false precision about agent-turn outcomes.
- Counters naturally return to zero when pi restarts, matching the scheduler's "runs only while pi is open" model.
- Existing callers of `SchedulerSnapshot`, `renderSchedulerSnapshot`, `coasStatus`, and `formatCoasStatusSlot` remain source-compatible because the new fields are optional.
- Tests can observe queue/failure accounting without mocking a durable backend.
- Continuation-enabled schedules are an opt-in exception: they gain durable, bounded, single-summary state while non-continuation schedules retain the original ephemeral behavior.

## Rejected alternatives

- **Correlated completion tracking**: rejected because `sendUserMessage` does not return a turn handle.
- **Durable Panopticon metrics store**: rejected because no long-term metrics store exists and adding one is out of scope.
- **New public `coas_scheduler_telemetry` tool**: rejected because telemetry is internal state and should surface through existing channels only.
- **Cross-extension event bus or importing `pi-panopticon` internals**: rejected by runtime-state boundaries and the "no cross-extension import" rule.
- **Logging prompt content or errors beyond existing bounds**: rejected to preserve privacy and bounded log behavior.
