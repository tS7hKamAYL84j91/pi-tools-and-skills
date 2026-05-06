# Pi CoAS internal scheduler plan

## Goal
Replace crontab-oriented CoAS scheduling with a pi-hosted internal scheduler. Schedule files remain the desired state; active in-memory timers become runtime reality while pi is open.

## Constraints
- Preserve existing schedule file format and model-callable `coas_schedule_add` parameters for compatibility.
- Do not execute schedules outside pi.
- Do not modify user crontab.
- Keep schedule execution explicit: inject a user message into pi when a schedule is due.
- Keep implementation small and testable with pure helpers for time matching.

## Architecture

```mermaid
C4Component
    title pi-coas internal scheduler
    Container(pi, "pi session", "Extension host", "Runs extension lifecycle and message injection")
    Component(coas, "pi-coas", "Extension", "Owns schedule tools, commands, and lifecycle")
    Component(files, "Schedule files", "~/.coas/schedules", "Desired schedule state")
    Component(scheduler, "Internal scheduler", "Timer loop", "Reconciles enabled schedules and queues due prompts")
    Component(agent, "Pi agent turn", "LLM runtime", "Executes scheduled prompt as normal user message")
    Rel(pi, coas, "loads")
    Rel(coas, files, "reads/writes")
    Rel(coas, scheduler, "starts/stops/reconciles")
    Rel(scheduler, files, "polls desired state")
    Rel(scheduler, agent, "sendUserMessage")
```

## Acceptance criteria
- `pi-coas` starts/stops an internal scheduler on session lifecycle.
- Schedule add/remove reconciles in-memory timers.
- `/coas-schedules`, `coas_status`, and `coas_doctor` report internal scheduler state instead of crontab state.
- Cron install/uninstall commands are replaced by internal scheduler commands/status.
- Tests cover due-time matching and schedule prompt rendering.
