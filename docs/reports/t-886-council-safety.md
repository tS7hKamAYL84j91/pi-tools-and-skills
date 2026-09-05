# T-886 ownership contract — manual council safety recheck

Status: active

Date: 2026-09-05
Seat: manual council safety
Review target: `docs/adr/059-goal-driver-ownership.md`
Disposition: **PASS — contract only, conditional on the stated implementation gates**

The failed Teams run produced zero output (`Agent is already processing`) and is not approval. No ownership implementation was reviewed or changed here. Source files remain read-only.

## Scope of recheck

Rechecked the reconciled ADR against the prior safety attack: cancellation/send TOCTOU, explicit linearization, revocation and release races, CAS after awaits, replacement ordering, watchdog participation, no-automatic-recovery portability, and confined path/symlink behavior. ADR-049 bounded liveness and ADR-051 binding authorization remain preserved. The design does not claim exactly-once delivery or exactly-once turns.

## Safety decision

**PASS for the bounded design, not for implementation.** ADR-059 now makes the required safety boundaries sufficiently explicit:

- canonical confined `cwd + goalId` instance identity;
- opaque owner token plus monotonically changing generation;
- lock-protected claim, revoke, release, send-admission, and state transitions;
- send admission recorded before calling the host outside the lock;
- token/generation/revision validation after every relevant await;
- durable revocation before waiter/marker cleanup;
- exact-token/generation conditional release;
- replacement intent and ADR-051 binding before replacement send;
- owner-only watchdog nudge, with no watchdog acquisition at an idle threshold;
- no automatic dead-owner takeover, TTL, lease service, or PID identity service;
- explicit authorized pause/stop/clear recovery followed by local `waitForIdle` before a new run/resume claim;
- malformed, substituted, symlinked, or unconfined paths fail closed.

This resolves the prior contract-level objections without expanding scope. It is not evidence that the current code satisfies the contract; the focused duplicate-driver test remains the implementation gate.

## Attack results and exact residuals

### Cancellation/send TOCTOU — accepted residual, correctly bounded

ADR-059 defines send admission as the lock transaction that verifies owner, generation, run, and attempt correlation and records the attempt before the host call. Cancellation before that transaction prevents admission. Cancellation after it cannot retract the call, including a call that has not yet reached the host due to scheduling. This is the unavoidable residual for an external call and the SDK's `void` send surface.

The contract correctly requires subsequent admissions and stale writes to fail. It also correctly says a void send has no delivery acknowledgement and that an awaited replacement rejection does not prove non-delivery. The implementation must test the admission boundary, not assert impossible cancellation of an already-admitted host call.

**Residual:** a remote or already-admitted call may execute after revocation. It must be reported as delivery/turn ambiguity, never as exactly-once success or cancellation.

### Stale writes after awaits — PASS with one required precision

The ADR requires each authoritative mutation to reread state and validate token, generation, run, and expected revision in one lock-protected transaction. This addresses the current `load -> await -> write` race and prevents a resumed callback from overwriting pause, edit, verification, completion, or replacement state. Attempt artifacts cannot reactivate a goal or prove completion.

**Implementation condition:** do not leave “or demonstrably equivalent correlation” implicit. Define one monotonic authoritative state revision and increment it on every mutating transition, including tools, watchdog transitions, pause/stop/edit/clear, replacement intent, and recovery. Every CAS failure must be a stale-callback no-op. Projection writes may be rebuilt and are not multi-file atomic; `goal.json` remains authoritative.

**Residual:** an admitted attempt artifact can exist even when its post-turn state transition is rejected. That is acceptable only if it carries the attempt identity and cannot affect authoritative state or completion evidence.

### Revocation, release, and active callbacks — PASS with token discipline

The ADR now makes revocation the durable invalidation boundary and release exact-token/generation conditional and idempotent. This prevents an old finalizer from deleting a successor claim. Old callbacks must settle only their own local waiter and cannot send, enqueue, or persist after generation mismatch.

**Implementation condition:** `resolve`, `pendingMarker`, cancellation sets, and callback context must be keyed by immutable goal/owner/attempt identity, not the current process-global unkeyed resolver. Revocation must happen before local cleanup. A finalizer must not clear a claim while a callback can still enter admission unless the generation check makes that callback harmless; the implementation must demonstrate this ordering in tests.

**Residual:** a callback already across admission may remain active while recovery begins. Recovery must not claim global quiescence; it may only prevent further admissions and stale writes.

### Session replacement ordering — PASS with explicit lifecycle obligations

The ADR correctly reserves replacement intent while still owner, installs the ADR-051 binding in `setup`, uses only fresh `withSession` context, and prevents old shutdown cleanup from revoking the logical handoff. Cancelled, failed, or unknown handoffs become interrupted/recovery-needed rather than immediate retries.

**Implementation conditions:**

1. Reserve intent and record its expected generation before `newSession`.
2. Ensure old `session_shutdown` can remove only old session-local timers/context, not the logical owner or successor handoff.
3. Validate reservation and perform send admission in `withSession` before awaiting replacement send.
4. On cancellation/failure, perform an owner-conditional interruption; on unknown outcome, retain recovery-needed state.
5. Verify the old callback's late release is a no-op after handoff.

**Residual:** the old session can shut down before the replacement callback runs, and a replacement send can be admitted while the old remote turn's final delivery status is unknown. ADR-059 documents this; no exactly-once or global quiescence claim is permitted.

### Watchdog — PASS for non-driver role

ADR-059 removes the unsafe automatic watchdog takeover. The watchdog is an owner-associated observer/recovery participant; a nudge requires current owner, current generation, idle host, and no queued continuation, and records an attempted nudge rather than proven delivery. Warning/timeout writes must use the same CAS discipline.

**Implementation condition:** an unowned watchdog must only surface lost-owner state. It must never send a nudge or claim a new owner. Two session watchdogs must not be able to turn one goal. The current `goal-watchdog.ts` and `goal-extension.ts` do not yet enforce this contract, so existing watchdog tests are not implementation evidence.

**Residual:** the void host may swallow an asynchronous nudge/provider failure. The persisted state must not claim delivery, and hard timeout/explicit recovery remains the bounded operator path.

### Dead-owner recovery and portability — PASS for the chosen explicit policy

The ADR makes the correct minimal choice: no automatic dead-owner takeover, no TTL, no lease service, and PID metadata is diagnostic only. An existing claim blocks new drivers regardless of age. An authorized existing pause/stop (or already-supported clear) revokes the generation; a subsequent explicit run/resume waits for the recovering local host to be idle before claiming a new generation.

**Residual:** local `waitForIdle` cannot prove a remote process/session is idle and cannot retract a remote admitted turn. The contract explicitly requires this ambiguity to remain visible. A user may need an authorized bound session capable of issuing pause/stop; an unbound ADR-051 session must not discover or recover another lineage's goal. Malformed/unverifiable ownership fails closed and requires operator repair guidance. No PID start-time inspection or portability-dependent recovery should be added in this slice.

### Confined paths and symlinks — PASS as fail-closed best effort

The ADR requires validated binding-derived IDs, existing no-symlink and regular-file checks for state/lock/ownership paths, inode/path race refusal, and token/identity-conditional cleanup. It explicitly does not claim kernel-level protection against an adversarial local directory replacement that Node's current helpers cannot prevent.

**Implementation conditions:** claim, lock, metadata, instance, and cleanup paths must all use the same confined derivation; no caller path or agent name may select ownership. A detected symlink, non-regular entry, changed inode, traversal, or confinement uncertainty must result in no send, no takeover, and no deletion. Tests must include substitution during claim/release.

**Residual:** check-then-use races against a hostile local filesystem actor cannot be eliminated with the current helper API. The required safe behavior is refusal when detected, not a claim of complete adversarial filesystem isolation.

## Required implementation gate

Before ownership implementation is accepted, the builder must demonstrate:

- one same-instance claim and one send admission under concurrent drivers;
- cancellation before/after admission with the stated residual semantics;
- monotonic revision CAS rejection around every await and all mutators;
- token-keyed waiter/marker settlement and harmless late callbacks;
- replacement shutdown/setup/withSession ordering and successor-safe release;
- watchdog owner-only nudge and no unowned takeover;
- explicit pause/stop/clear revocation followed by local idle wait, with remote ambiguity tests/documentation;
- malformed claim, traversal, symlink, inode replacement, and fail-closed cleanup tests;
- persistence/UI failure behavior without falsely announcing recovery;
- SDK void-send versus awaited replacement-send behavior;
- existing ADR-049/051/055 and T-886 regression coverage, with the duplicate-driver test retained and passing;
- full checks/tests and independent implementation review before commit.

No automatic PID/dead-owner recovery, lease service, daemon, or unrelated architecture work is required or authorized by this safety review.

## Final verdict

**PASS — reconciled ADR-059 contract for the manual safety seat, conditional on the implementation gates above.** This is not implementation approval, does not count the failed Teams run as approval, and does not claim historical process-death causality or exactly-once behavior.
