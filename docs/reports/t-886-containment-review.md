# T-886 retained parser/error-containment review

Status: active

Historical stage verdict; see `t-886-final-validation.md` for current status.

Date: 2026-09-05
Review scope: retained parser, runtime/steering containment, and diagnostics diff only
Disposition: **PASS — bounded containment slice only**

This review does not approve T-886 as a whole and does not approve or review ownership implementation. The duplicate-driver test is known, intentionally deferred, and remains red; it is reported as evidence, not used to skip this bounded review. No source edits, commits, or live-provider/session actions were performed. Only this report was written.

## Focused evidence

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
10 tests: 9 passed, 1 failed
failed: prevents two independent drivers from steering one persisted goal
       expected sends 1, received 2

npx vitest run tests/goal
9 files: 66 passed, 1 failed
same duplicate-driver failure
```

The nine passing focused cases cover the retained alias, runtime failure paths, diagnostic redaction/fallback, persistence/UI failure behavior, and steering containment. The red case is the separately assigned ownership defect.

## Findings

### Parser compatibility — PASS

`extensions/pi-goal/goal-helpers.ts:69-71` maps exactly the bare `continue` token to `resume`. `continue improving the parser` still follows the existing objective path, preserving implicit objective syntax. No broader grammar change is introduced.

### SDK send semantics — PASS with explicit host limitation

Installed SDK types and implementation confirm:

- `ExtensionAPI.sendUserMessage` is `void` (`dist/core/extensions/types.d.ts:980`) and the loader delegates without returning the promise (`dist/core/extensions/loader.js:300-303`).
- The host calls `AgentSession.sendUserMessage(...).catch(...)` and emits a runner error (`dist/core/agent-session.js:2013-2021`). Its underlying `AgentSession.sendUserMessage` is async and awaits `prompt` (`:1161-1191`).
- `ReplacedSessionContext.sendUserMessage` is `Promise<void>` (`types.d.ts:297-305`) and the run loop awaits it.
- The extension documentation states that a void `pi.sendUserMessage` always triggers a turn and throws synchronously when an invalid streaming delivery mode is used; it does not expose provider rejection to this caller.

The retained code correctly catches synchronous throws from the void surface and awaits/catches replacement-context rejection. It does **not** falsely claim that a host-swallowed async provider failure can be caught by this code. That limitation remains visible and is not a defect in this slice.

### Diagnostic redaction and control safety — PASS for the defined bounded policy

`extensions/pi-goal/goal-diagnostics.ts`:

- accepts only `Error.message` or a string; arbitrary thrown objects use the safe fallback rather than stringifying potentially sensitive object fields;
- removes CSI ANSI sequences;
- replaces C0/C1 controls, including newline, with spaces and collapses whitespace to one line;
- applies the existing `redactSecrets` helper before the 400-character bound;
- uses `Goal runtime failed.` for empty/unusable diagnostics.

The focused test proves `token=super-secret` is persisted as `token=[REDACTED]`, ANSI/newline content is normalized, and a secret-bearing non-Error object is not serialized. Redaction remains best-effort by design: `lib/secret-redaction.ts` covers common assignment and Authorization forms, not every possible secret encoding. The retained code does not introduce a raw diagnostic into `lastError` or the user-facing containment notification.

Residual: `Error.cause` on a containment-persistence/UI wrapper retains the raw secondary error object in process memory and may be visible to a host error logger. The wrapper message is sanitized and bounded, but callers must not serialize or display the cause as a user diagnostic. This is an implementation integration obligation, not a reason to reject the bounded state/UI policy.

### Pending waiter and marker settlement — PASS for covered failure paths

`runGoalLoop` now creates the waiter before initial/replacement send. `clearPendingRuntime` clears `runtime.resolve`, resolves it with `[]`, cancels the continuation marker, and resets `stopRequested`. It is used for initial `waitForIdle`/send containment and replacement send/rejection; cancelled `newSession` also clears the waiter and marker. Steering containment performs the same cleanup before its persistence attempt.

The tests assert the initial-send waiter and marker are cleared and assert waiter settlement when persistence fails. This prevents a containment failure from leaving the loop blocked on an unresolved promise.

Residual: the runtime resolver is still the existing process-global, unkeyed state and can be confused by independent drivers. That is the known ownership scope and remains outside this retained containment approval.

### Authoritative persistence/UI failure honesty — PASS

Both containment paths settle local runtime state before attempting recovery persistence. They then:

1. await `saveGoal` as the authoritative state write;
2. propagate a bounded `Goal containment persistence failed: ...` wrapper if that write fails, without notifying that the goal paused;
3. only after successful persistence attempt UI refresh;
4. propagate a bounded UI-refresh failure while leaving the persisted pause authoritative;
5. notify “paused” only after both persistence and refresh succeed.

The focused tests establish the two important honesty cases: persistence failure leaves the persisted active state unchanged and does not falsely announce pause; UI failure occurs after persisted `runActive: false` and is surfaced. This is an appropriate fail-closed distinction: local waiter cleanup is still completed, but the code does not claim an authoritative pause it could not write.

Residual: if `saveGoal` partially writes `goal.json` and then fails while writing projections, the underlying persistence helper's authority/projection contract determines the result. The containment layer cannot claim a successful pause and correctly propagates the failure. Existing persistence tests remain the relevant authority for atomic write behavior.

### Error paths not exposed by the retained diff

The retained `try/catch` cannot contain:

- asynchronous rejection from `ExtensionAPI.sendUserMessage` after the host has accepted the void call;
- provider errors reported by the host runner rather than returned to this extension;
- stale concurrent state writes or duplicate sends;
- ownership/revocation/replacement races.

These are intentionally not approval gaps for this bounded slice, but they prevent interpreting the nine passing tests as host safety or complete T-886 reliability.

## Required interpretation

- Keep the duplicate-driver regression red until the coordinated ownership/persistence work is separately implemented and reviewed.
- Do not convert the void host call to an assumed promise or add an unhandled `await` cast.
- Preserve sanitized bounded diagnostics and the fallback behavior.
- Preserve waiter settlement before containment persistence and the distinction between authoritative persistence failure and UI-only failure.
- When integrating, ensure raw `Error.cause` is not emitted as a user-visible or persisted diagnostic.
- Do not infer async provider delivery success/failure from the void return.

## Verdict

**PASS — retained parser/error/diagnostic containment diff, bounded to this slice.** It is source-grounded and test-supported for the requested synchronous/awaited failure boundaries, diagnostic policy, waiter cleanup, and persistence/UI honesty. This is not approval of the deferred duplicate-driver behavior, ADR-059 ownership design, or the complete T-886 patch.
