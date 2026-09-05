# T-886 baseline regressions and bounded parser/containment fix

Status: active

Historical stage evidence only; later implementation supersedes open findings. See `t-886-final-validation.md` for current status.

Date: 2026-09-05
Branch: `fix/t-886-goal-reliability`

## Scope

Read the T-886 plan, diagnosis and augmentation briefs, ADR-049/051/055, current `extensions/pi-goal/` runtime, existing goal tests, and installed pi extension/SDK documentation. The installed SDK was verified directly:

- `ExtensionAPI.sendUserMessage(...)` is typed as `void` and its documented active-turn modes are `deliverAs: "steer" | "followUp"`.
- `ReplacedSessionContext.sendUserMessage(...)` is typed as `Promise<void>`.
- The installed `AgentSession.prototype.sendUserMessage` implementation is `async` and awaits `prompt(...)`; the extension API wrapper therefore must not be treated as an async rejection channel unless the host exposes that promise.

No live goals, settings, providers, sessions, restarts, augmentation, cross-repo writes, commit, push, merge, or driver-owner persistence/lease changes were performed.

## Baseline captured before the authorized fix

Command:

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
```

Result before production changes: **4 failed, 0 passed**.

Failures established:

1. `parseCommand("continue")` returned `{ action: "goal", rest: "continue" }`.
2. Initial run-driver `sendUserMessage` failure escaped and left the goal active.
3. Two independent fake drivers each sent a turn (`2`, expected `1`).
4. `/goal steer` delivery failure escaped and left the goal active.

## Authorized changes

### Parser alias

`extensions/pi-goal/goal-helpers.ts:69-71` now maps the canonical approved compatibility alias `continue` to `resume`. Ordinary non-command objective text remains on the existing goal-creation path; no broad grammar change was made.

### Run-loop containment

`extensions/pi-goal/goal-run-loop.ts:25-29,46-70` now contains:

- `waitForIdle()` rejection;
- synchronous initial `pi.sendUserMessage()` throws, matching the installed ExtensionAPI `void` surface;
- `newSession()` rejection;
- asynchronous replacement-session `sendUserMessage()` rejection.

The containment path (`:103-129`) clears the pending resolver and continuation marker, resets the runtime stop flag, persists ADR-049 `interrupted`/recoverable state with a maximum 400-character `lastError`, refreshes UI, and notifies the operator. Persistence is awaited directly; persistence failures are not swallowed or replaced by the runtime error.

### Steering containment

`extensions/pi-goal/goal-commands.ts:211-216,282-303` catches synchronous `/goal steer` delivery failures, clears pending runtime state, persists paused/interrupted recoverable state with bounded `lastError`, refreshes UI, and notifies the operator. Existing active-turn `deliverAs: "steer"` behavior is unchanged.

## Regression tests added/updated

`tests/goal/t-886-baseline-regressions.test.ts` now covers:

- `continue` → `resume` parser compatibility;
- synchronous initial send throw;
- `waitForIdle()` rejection;
- `newSession()` rejection;
- async replacement-session send rejection;
- `/goal steer` synchronous delivery failure;
- the original duplicate-driver test, retained unchanged in intent and still red.

The tests assert inactive recoverable state, bounded error text, and pending resolver/marker cleanup where applicable. They do not assert provider transport propagation through a host that may swallow the ExtensionAPI's void-returning call.

## After-fix evidence

Focused command:

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
```

Result: **1 failed, 6 passed**. The only failure is the deliberately deferred duplicate-driver regression:

```text
prevents two independent drivers from steering one persisted goal
expected sends 1, received 2
```

Goal suite:

```text
npx vitest run tests/goal
```

Result: **1 failed, 63 passed** across 9 files; the sole failure is the same deferred duplicate-driver regression.

Repository check:

```text
npm run check
```

Result: passed (`typecheck`, lint, knip, and 99.23% strict type coverage). Biome emitted existing informational/fixable diagnostics in unrelated pi-event-loop files; lint exited successfully.

## Deferred duplicate-driver defect

The retained red test demonstrates that `goal-run-loop.ts` can concurrently steer one persisted goal from two independent runtime owners. No owner token, lease, or cross-process persistence boundary was added in this authorization.

Minimal separate proposal for review: claim a goal instance before the first send with a bounded owner token/lease under the existing confined advisory-lock boundary; reject a second live owner; define stale-owner takeover and release/transfer at pause, stop, shutdown, and replacement-session handoff. This requires an explicit authority decision and must not be hidden inside the parser/containment fix.

The duplicate-driver regression does not reproduce process death or prove that it caused historical abrupt JSONL truncation. Process-death mechanism remains unresolved.

## Independent review follow-up: bounded findings 3/4

Council/GM direction explicitly deferred ownership, stale-mutation, and watchdog-contract work. No ownership or watchdog production changes were made here.

Added `extensions/pi-goal/goal-diagnostics.ts` as the shared diagnostic formatter used by run-loop and steering containment. It:

- accepts only `Error.message` or string input; non-Error objects use `Goal runtime failed.`;
- removes ANSI escape sequences and normalizes control characters/newlines to bounded single-line text;
- applies the existing `redactSecrets` helper before the 400-character cap;
- provides a safe fallback for empty/unusable diagnostics.

Containment persistence/UI semantics are now explicit in both paths:

- settle the pending waiter and clear markers before containment persistence;
- await authoritative `saveGoal`; if it fails, propagate a bounded `Goal containment persistence failed: ...` error and do not notify that the goal paused;
- only after a successful write, attempt UI refresh; if it fails, propagate a bounded `Goal containment UI refresh failed: ...` error while the persisted pause remains authoritative;
- persistence and UI errors are not silently swallowed or replaced by an unbounded provider diagnostic.

New tests were added before these changes for diagnostic redaction/control normalization, non-Error fallback, persistence failure with waiter settlement and no false pause, and UI failure after successful persistence. The pre-change focused run was **10 tests: 2 failed** (diagnostic safety and duplicate driver); the persistence/UI tests captured the existing propagation behavior. The original duplicate-driver test remains untouched and red.

## Updated evidence

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
10 tests: 9 passed, 1 failed
failure: prevents two independent drivers from steering one persisted goal (expected sends 1, received 2)

npx vitest run tests/goal
9 files: 66 passed, 1 failed
same duplicate-driver failure

npm run check
PASS — typecheck, lint, knip, and strict type coverage (99.23%)
```

The focused red test is the explicitly deferred ownership defect; no ownership fix was attempted. No commit/push/merge was performed. Await council/GM review.

## ADR-059 implementation blocker

Ownership implementation is **blocked and was not retained**. The current persistence API exposes `saveGoal(state)` as a void mutation boundary with no returned authoritative revision, while every existing command, tool, watchdog, lifecycle hook, replacement handoff, and test fixture constructs and persists independent snapshots. ADR-059 requires a single lock-protected transaction API with a monotonic revision on every mutation, token/generation CAS after every await, and owner-keyed waiter state. Adding only a claim around `runGoalLoop` is insufficient: it permits stale post-await writes and leaves tools, pause/stop/edit/clear, watchdog transitions, replacement shutdown, and completion mutations outside the contract.

A bounded prototype of claim/revision fields was deliberately reverted after it produced 17 goal-suite failures, including stale writes in authority/session/gate tests and run-loop waiter timeouts. This is concrete evidence that the migration must be designed as one coordinated persistence/mutation refactor, not improvised as a local owner check. No ownership, watchdog, revision-schema, or ADR-index/C4 changes are present in the retained diff.

The retained focused evidence is therefore unchanged for ownership:

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
10 tests: 9 passed, 1 failed
failure: prevents two independent drivers from steering one persisted goal (expected sends 1, received 2)
```

Required next authorization/design step: define and implement the transaction return/update contract first (including legacy/test compatibility and all mutator call sites), then add the child-process and stale-await race fixtures before wiring claim/admission. Do not add a partial claim or automatic recovery.

## Review gate

Production changes remain bounded to parser compatibility, run/steering containment, shared safe diagnostics, and explicit containment failure semantics. Await GM/council direction on the coordinated ADR-059 persistence migration before any owner boundary, lease, stale-write guard, watchdog contract, ADR index/C4 update, broader grammar change, or augmentation.
