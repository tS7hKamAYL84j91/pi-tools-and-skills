# T-886 independent review

Status: active

Historical pre-ADR verdict; ADR-059 supersedes its proposed automatic recovery. See `t-886-final-validation.md` for current implementation status.

Date: 2026-09-05
Branch: `fix/t-886-goal-reliability`
Disposition: **REVISE**

## Review boundary and evidence

Read-only audit of the candidate diff and the requested goal, persistence, watchdog, binding, continuation, lock, plan, ADR, test, and installed pi SDK surfaces. No source/test/live-state/settings/provider/session/Kanban changes were made. The only write is this report.

Focused evidence:

```text
npx vitest run tests/goal/t-886-baseline-regressions.test.ts
7 tests: 6 passed, 1 failed
failure: prevents two independent drivers from steering one persisted goal
expected sends 1, received 2

npx vitest run tests/goal
9 files: 63 passed, 1 failed
same duplicate-driver failure
```

The candidate improves the original baseline from 4 failures to 1 failure, and the six containment/alias cases pass. That is not sufficient for PASS because the remaining failure is the central persisted-goal ownership invariant.

The installed SDK confirms the important host boundary:

- `ExtensionAPI.sendUserMessage` is typed `void` and the loader delegates to the host action without returning its promise (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:980`; `dist/core/extensions/loader.js:300-303`).
- The host action invokes `AgentSession.sendUserMessage(...).catch(...)`, so provider/turn rejection is reported to the extension runner rather than returned to the caller (`dist/core/agent-session.js:2013-2021`).
- `ReplacedSessionContext.sendUserMessage` is async/`Promise<void>` and is correctly awaited by the candidate (`types.d.ts:297-305`; `docs/extensions.md` session replacement section).

Therefore the candidate's synchronous catches around `pi.sendUserMessage` are appropriate for the exposed API, but they do not prove containment of asynchronous host/provider failures. The replacement-session send is a real awaited rejection channel.

## Findings

### 1. Blocking: no single-driver ownership

`extensions/pi-goal/goal-run-loop.ts:31-78` performs no claim before creating the waiter or sending the first turn. Two independent runtimes can both observe the same `initialState.runActive` and each call `pi.sendUserMessage`. The focused regression reproduces exactly that: two sends, despite per-file advisory locks.

`lib/file-lock.ts` only serializes the callback's short filesystem critical section. `saveGoal`/`loadGoal` release it before the provider turn, so it cannot establish ownership across an awaited turn, session replacement, watchdog nudge, or process lifetime. Atomic JSON persistence prevents torn files, not duplicate drivers or lost updates.

### 2. High: stale read/modify/write windows remain

After `await agentDone`, the loop loads `latest` (`goal-run-loop.ts:79-87`), then separately awaits `writeGoalIteration` and later `saveGoal` (`:88-100`). Another command/watchdog/driver can mutate the goal between those awaits. The subsequent derived state can overwrite a newer pause, edit, run, or owner decision. The same shape exists in the steering failure path: `handleSteer` saves and refreshes, then on a synchronous delivery error constructs failure state from the earlier `next` and saves it (`goal-commands.ts:210-216, 282-303`). The candidate does not use an owner token or compare-and-swap/version check to reject stale lineage writes.

This is not demonstrated by the passing mocks, which have one writer and no interleaving. It is a source-level race against the stated session-lineage contract.

### 3. Medium: failure of containment persistence is not contained

`pauseAfterRuntimeError` settles the waiter before persistence, which is the right ordering, but `saveGoal` and `refreshUi` are awaited without a second failure boundary (`goal-run-loop.ts:103-118`). If persistence or UI refresh fails while handling the original runtime error, the command/loop rejects and no operator notification is guaranteed. This is defensible as fail-closed rather than falsely claiming recovery, but it must be an explicit contract and tested as failure-on-failure. Current tests do not inject persistence or refresh failure.

The same issue exists in steering containment (`goal-commands.ts:282-303`). A safe implementation should preserve waiter settlement, avoid replacing the original diagnostic with an unbounded secondary error, and surface a bounded emergency failure without claiming the goal was paused when the authoritative write failed.

### 4. Medium: error bounding is truncation, not sanitization

`runtimeErrorMessage` and steering handling use `Error.message`/`String(error)` and slice to 400 characters (`goal-run-loop.ts:131-134`; `goal-commands.ts:284-296`). This bounds length but permits control characters/newlines and arbitrary provider text into JSON/projections/UI. It also does not normalize non-Error objects meaningfully. The tests verify ordinary length/content only. At minimum, define and test a shared bounded diagnostic sanitizer (control-character policy, newline policy, and safe fallback), while retaining the original error only in process-local logging if such logging is permitted.

### 5. Medium: watchdog remains a possible second driver

`goal-extension.ts:25-39` starts a watchdog per session and its `sendNudge` calls the void-returning `pi.sendUserMessage`; it has no persisted owner check. `goal-watchdog.ts:66-115` persists `livenessNudgeIssued` before delivery and treats synchronous throws as failure, but an asynchronous host/provider rejection is outside the void surface and can be swallowed by the host. A watchdog in another process/session can therefore race the run loop or mark a nudge issued without proving delivery. Ownership must cover watchdog actions; the watchdog should observe/recover only under the same owner protocol, never become an uncoordinated driver.

## Pending waiter and lifecycle review

The candidate does settle the loop waiter on the reviewed synchronous/replacement failure paths: `clearPendingRuntime` clears `runtime.resolve`, resolves it with `[]`, cancels the marker, and resets `stopRequested`. The cancelled `newSession` path does the same. This is a positive result.

The global `GoalRuntime` is process-global (`Symbol.for`) rather than goal/session keyed. That helps an in-process extension reload share state, but it also means unrelated session instances can overwrite `resolve`, `pendingMarker`, and cancellation state. Session shutdown cancels only the marker (`goal-extension.ts:43-47`), not a persisted driver claim or a waiter associated with a specific owner. Replacement callbacks correctly use the fresh replacement context for the awaited send, but no explicit ownership transfer protects the handoff.

The candidate reloads persisted state after a turn, which is better than blindly writing the initial snapshot. It still has no stale-goal/lineage guard across the later awaits described above.

## Smallest safe ownership fix (design only; not implemented)

This is the minimum bounded design I recommend for a council/ADR decision before implementation. It is not a lease service and does not change parser grammar, augmentation, or completion authority.

### Coordination key and record

- Key: the confined persisted goal instance identity, `cwd + goalId` (equivalently the instance `goal.json` path), not display name, model, or merely the session file. ADR-051 binding still authorizes which instance a session may access; the key prevents two authorized lineages from driving that instance concurrently.
- Reuse the existing atomic advisory-lock machinery and metadata shape (`pid`, `createdAt`, `ownerId`) from `lib/file-lock.ts`. Add only a narrowly scoped driver-claim operation around the instance, with an owner token containing process identity plus session/replacement lineage identity. Do not hold the ordinary state lock across provider I/O; its current retry-bound critical section is for file operations only.
- Persist the owner token in the instance's authoritative state or a confined sidecar claim record, updated under the existing state lock with an atomic write. Every driver action must verify the token immediately before send and before post-turn persistence. A mismatched token is a no-op/stop, never a stale write.

### Ownership across lifecycle

- **Process/session:** `/goal run` and `/goal resume` first claim `cwd + goalId`; a live conflicting claim is rejected with no send. Commands that pause, stop, edit, clear, or start a new run revoke the claim under the same lock.
- **Replacement:** keep one logical owner token across `newSession`; setup writes the existing binding, and `withSession` transfers the driver context before its awaited replacement send. The old context must not release the token after the new context has taken it. Transfer/release must be token-conditional.
- **Watchdog:** watchdog is not an independent driver. It may nudge only if it can prove the current owner token is absent/stale and claim atomically, or (preferably for the smallest fix) it only signals the already-owned driver and records no send unless that owner is present. A nudge must revalidate ownership immediately before delivery.
- **Shutdown/cancellation:** session shutdown, stop, pause, failed send, cancelled replacement, budget exhaustion, and hard timeout release/revoke only their own token. Cancellation must first invalidate the token, then settle the waiter, then perform best-effort cleanup; a late callback cannot reacquire or persist using the old token.

### Dead-owner recovery without arbitrary TTL takeover

Do not infer death from age. If the claim owner process is alive, never take it over regardless of elapsed time. Recovery requires an OS liveness check for the recorded PID plus process-start identity (for example, Linux `/proc/<pid>/stat` start time) to avoid PID reuse; malformed/unverifiable metadata fails closed. Only a confirmed-dead owner may be removed/replaced under the atomic advisory lock. If the platform cannot establish safe death, require explicit operator pause/clear/restart action rather than arbitrary TTL takeover.

The current advisory primitive records PID but does not expose a safe claim inspection/recovery API and does not itself solve PID reuse. Those are its limitations; do not pretend its retry timeout is an ownership lease.

## Required test matrix for the ownership follow-up

1. Two runtimes, same `cwd + goalId`: exactly one claim and one send; second driver receives a bounded refusal.
2. Two processes with the same live PID metadata and different session identities: no takeover; no duplicate send.
3. Confirmed-dead owner recovery; PID reuse/start-time mismatch; malformed claim; lock symlink/path traversal; all fail closed as appropriate.
4. In-process reload and two independent session lineages sharing a cwd: binding isolation plus single-driver exclusion.
5. Replacement session: binding exists before send, same owner token survives handoff, old context cannot release or write afterward.
6. Stop/pause/edit/clear racing initial send, awaited replacement send, agent-end, and continuation: waiter settles once; late callbacks cannot persist stale state.
7. Watchdog soft warning, idle nudge, active turn, queued continuation, hard timeout, shutdown, and a second watchdog: no second driver and no false nudge success through the host's void surface.
8. Initial void send synchronous throw, host-swallowed asynchronous rejection, awaited replacement rejection, `newSession` rejection/cancellation, and steering failure: bounded diagnostic, fail-closed state, no pending waiter/marker leak.
9. Persistence failure while containing another failure: original waiter is settled; authoritative state is not falsely marked recovered; secondary failure is bounded and observable.
10. Existing parser compatibility, ADR-049/051/055 plan/gate/correlation/liveness tests, focused goal suite, `npm run check`, and `npm test` remain green.

## Verdict

**REVISE.** Accept the parser alias and the bounded synchronous/awaited containment changes as a partial improvement, but do not approve the candidate as a complete T-886 reliability patch. The duplicate-driver regression is reproduced and directly violates the required single-driver property. Implement the ownership design only after council/ADR approval; do not fold it into this review report or assume passing mocks establish host safety.
