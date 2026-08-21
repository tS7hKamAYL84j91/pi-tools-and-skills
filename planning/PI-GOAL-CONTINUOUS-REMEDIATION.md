# pi-goal Continuous Execution and Liveness Remediation

## Status

Completed in `feat/pi-goal-continuous-liveness`; ADR-049 accepted by Principal direction after root/peer design agreement. Root and independent re-audits passed after all six review blockers were fixed.

## Goal

Let an operator explicitly start a goal in continuous mode and have it progress across successfully verified milestones without manually issuing `/goal run` after every transition, while preserving approval, verification, completion, and stop controls.

## Accepted scope, in priority order

1. **Continuous start UX**
   - `/goal <objective> --until-complete` or `--continuous` creates and starts immediately.
   - Persist `runMode: manual | continuous`; manual remains the default.
   - In continuous mode, a passing `goal_verify` plus root-owned `goal_complete` advances the milestone with execution still active so the existing continuation path starts the next turn.
2. **Evidence correlation**
   - Bind `goal_verify` and `goal_complete` evidence to the current `runId` and milestone revision.
   - Reject stale worker/run evidence after replanning, editing, restart, or milestone transition.
3. **Structured lifecycle visibility**
   - Surface bounded goal/milestone events equivalent to turn started, plan updated, progress, interrupted, failed, and completed.
   - Include current milestone checklist, turn budget/usage, changed-file summary, and bounded evidence summary.
4. **Steering and resume semantics**
   - Add `/goal steer` for current-run guidance without invalidating the approved plan.
   - Make `/goal resume` actually continue execution, or rename it to match its behavior.
5. **Normalized execution state**
   - Replace ambiguous status plus `runActive` combinations with explicit `idle | in_progress | interrupted | failed | completed` execution semantics and a migration path.
6. **Trust labels**
   - Preserve explicit trust boundaries for objective text, source files, and additional steering context.
7. **Bounded liveness recovery**
   - Persist `lastProgressAt` and a liveness epoch; update only on meaningful transitions.
   - Use an unref'd in-process watchdog with operator-configured safe defaults and hard caps.
   - Warn once at a soft timeout; when no agent turn is active, send at most one continuation nudge.
   - Never inject into an active turn. At hard timeout, pause with an actionable error; never auto-complete.
   - Recover from restart using persisted timestamps and clear timers on shutdown.

## Mandatory stop conditions

Continuous execution stops on pause, stop, interruption, provider/agent error, failed verification, stale evidence, exhausted turn budget, hard liveness timeout, or completion-gate failure.

## Non-goals

- No automatic goal completion.
- No bypass of plan approval, milestone verification, root completion audit, or trusted operator gate.
- No persistent CoAS schedule or external polling service.
- No fixed two-minute cadence without ADR review and operator configuration bounds.

## Required tests

- Continuous start and automatic cross-milestone continuation.
- Manual default remains paused between milestones.
- Run/milestone-revision stale-evidence rejection.
- Pause, stop, steer, resume, error, verification failure, gate failure, and budget exhaustion.
- Structured lifecycle/status projections and bounded summaries.
- Fake-timer watchdog tests: soft warning, one-shot idle nudge, active-turn non-interference, hard pause, restart recovery, and shutdown cleanup.
- State-schema migration and projection authority tests.

## Implementation plan

1. Extend the authoritative goal state with explicit run mode, normalized execution state, milestone revision, correlated verification, lifecycle records, and bounded liveness disposition; migrate v1/v2 fail-closed to manual mode.
2. Keep pure transitions in `goal-plan.ts` and persistence/projection updates in `goal-persist.ts`; add correlation and lifecycle helpers without widening shared library boundaries.
3. Update command/tool execution so continuous mode only follows a passing non-final root completion transition, while pause/stop/error/gate/budget/stale evidence halt continuation; make resume start the loop and steer queue current-run guidance.
4. Add a session-scoped unref'd watchdog with injected timer seams for one warning, one idle nudge per epoch, active-turn protection, restart reconstruction, hard-timeout pause, and shutdown cleanup.
5. Update render/context/README/architecture docs, then add focused fake-timer and migration/correlation tests before running the full gates.

## Review and acceptance checks

- Inspect the final diff for untouched Teams, Boost, CoAS, Kanban, and `lib/team-protocol-spi.ts` paths.
- Run `npm run check` and `npm test`.
- Verify projections are derived only after authoritative state writes and all liveness injections carry current run/epoch correlation.

## Delivery gates

- [x] ADR-049 accepted before implementation.
- [x] Mermaid architecture/state-flow updated.
- [x] `npm run check` passed at 99.23% type coverage.
- [x] `npm test` passed: 177 files / 1,399 tests.
- [x] Independent review of state migration, completion trust boundary, and liveness behavior passed.
