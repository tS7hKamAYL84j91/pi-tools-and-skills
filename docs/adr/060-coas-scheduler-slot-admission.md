# ADR-060: CoAS scheduler slot admission and uncertain handoff

## Status

**Accepted for implementation only — 2026-09-05.**

Acceptance is limited to this corrected bounded design, based on the two manual council seats/reports reconciled by this draft and the [final ADR-060 safety recheck](file:///tmp/t888-adr060-safety-recheck.md), which returned **PASS**. It is not acceptance of the current or prior T-888 prototype, and it does not authorize merge, commit, push, activation, live schedules, provider operations, or new administration UI.

## Context

`CoasInternalScheduler` can run startup catch-up in more than one process. In-memory `lastRun`/`activeRuns` state cannot exclude a repeated `(taskId, UTC minute slot)` across processes. T-888 adds exclusive per-slot files, but its five-minute reclaim can delete a claim after an external `sendUserMessage` handoff and issue a duplicate prompt.

The host API does not prove provider delivery. A call returning, or even throwing, is not by itself proof that no external side effect occurred. Approval-gated runs also need an explicit slot state rather than being classified through a generic executor boolean.

T-795's shared `ConfinedStore` remains the filesystem boundary. Its narrow defense-in-depth checks are accepted; they do not provide a TOCTOU-free guarantee.

## Decision

### Canonical occurrence

The canonical occurrence key is `(validated taskId, UTC minuteKey(occurrence))`. Slot paths remain under the confined `schedule-runs` runtime root. Records are bounded and secret-free: no prompt, provider payload, or credential.

### Exclusive token claim and lock-held CAS

A reservation is created with an exclusive filesystem operation. The successful result returns an opaque claim token/generation and the canonical slot identity. A second process gets a conflict/no-op and cannot send.

Initial reservation is exclusive creation. Every subsequent transition is a lock-held compare-and-set transaction, not merely an atomic rename:

1. acquire a uniquely scoped per-slot advisory lock through the confined store;
2. reread the current record while holding that lock;
3. validate canonical task/slot identity, bounded record shape, exact token/generation, and expected current status;
4. write the next record atomically while still holding the lock, or return conflict/no-op;
5. release the lock only after the replacement is durable.

Atomic replacement provides complete-file visibility; the lock makes read/validate/write conditional. A stale token, successor record, malformed record, or unexpected status cannot be overwritten. Shared `ConfinedStore` must be reused; no parallel confinement primitive is permitted.

### State machine

```mermaid
stateDiagram-v2
  [*] --> absent
  absent --> reserved: exclusive token claim
  reserved --> admitted: no approval; lock-held CAS
  reserved --> approval_pending: approval required; no host call
  approval_pending --> rejected: explicit denial; terminal no-send
  approval_pending --> deferred: explicit deferral; terminal no-send
  approval_pending --> admitted: approval; same-token lock-held CAS
  admitted --> host_called: host invocation boundary crossed
  admitted --> failed_pre_handoff: proven before invocation only
  admitted --> uncertain: invocation/handoff ambiguous
  host_called --> host_call_returned: host call returned
  host_called --> uncertain: outcome/status not authoritative
  failed_pre_handoff --> reserved: later explicit scheduler retry
  rejected --> [*]
  deferred --> [*]
  host_call_returned --> [*]: terminal host-call record; not provider delivery
  uncertain --> [*]: blocked pending existing authorized intervention
```

`reserved`, `approval_pending`, `admitted`, `host_called`, `host_call_returned`, and `uncertain` block automatic re-admission/retry for that slot. `failed_pre_handoff` is the only automatically retryable outcome, and only through a later scheduler occurrence/retry that obtains the valid transition. Rejected/deferred are terminal no-send outcomes for this slot; a later occurrence has its own slot identity. `host_call_returned` is not “delivered” and is not provider confirmation. `uncertain` remains blocked.

### Admission and handoff uncertainty

Admission is the transaction immediately before external work:

1. validate current token, slot identity, schedule eligibility, and approval state;
2. atomically write `admitted` and its attempt identity under the lock-held CAS;
3. release filesystem coordination;
4. invoke `pi.sendUserMessage`.

After step 2, cancellation cannot retract the host work. If the host call is invoked, transition to `host_called` when the caller can do so with the same token. This records host-call state, not provider delivery.

Only a failure proven to occur **before invocation** is retryable. A synchronous throw from `sendUserMessage` is not sufficient evidence: unless an adapter proves `handoff: "not-started"` before invocation, classify the result as `uncertain`, fail closed, and never retry automatically. A crash after admission before `host_called` persistence is also uncertain, regardless of whether the call probably ran.

The current void API cannot provide provider acknowledgement and generally cannot prove whether a thrown call had side effects. The design therefore prefers blocking uncertainty over duplicate externally handed-off prompts.

### Approval is first-class and same-token

Approval is part of the slot state machine, not a generic `execute() === false` convention.

For an approval-required occurrence, reserve the slot and create/reference an approval artifact carrying the same slot identity and token/generation. Coordinate artifact creation and `approval_pending` persistence under the slot transaction boundary: no approval artifact may authorize a different token, and a failure leaves no send authorization. If the two bounded files cannot be committed as one filesystem operation, an orphan artifact is inert and must not be treated as approval for a slot lacking the matching pending record.

Authorized approval resume rereads the slot under the per-slot lock, validates the same token/generation and approval request, and performs exactly one CAS from `approval_pending` to `admitted` before the host call. Duplicate resume, stale approval, rejection, deferral, or restart returns conflict/no-op. No approval path may retry an uncertain handoff.

An unapproved prompt is never admitted or sent. Existing approval authority and artifacts remain the authority; no new generic approval/recovery UI is introduced by this ADR.

### No age/PID takeover

There is no stale-age lease, PID liveness test, automatic takeover, or retry after a five-minute timeout. Age is diagnostic only. A reserved/admitted/uncertain slot remains blocking across restart and process death.

Uncertain state is surfaced in existing bounded scheduler diagnostics and requires existing authorized operational intervention. This slice adds no generic recovery UI and no implicit file deletion. If no safe existing intervention is available, the slot remains blocked rather than being guessed recoverable.

### T-795 boundary

T-888 uses the T-795 shared `ConfinedStore` and its narrow defense-in-depth checks for roots, paths, regular files, and symlink components. Neither ADR claims elimination of check-then-use races. A broader descriptor-relative or kernel-level race-resistant redesign is out of scope.

## Consequences

- Cross-process same-slot exclusion is durable.
- A crash after admission can lose liveness for that occurrence, but cannot silently authorize a duplicate prompt.
- Retry remains available for a proven pre-handoff failure only.
- Approval pending/resume is durable and unambiguous.
- The scheduler may require explicit operator intervention for uncertain records; this is intentional fail-closed behavior.
- No provider-delivery exactly-once guarantee is claimed.

## Required evidence

Tests must cover:

1. two processes racing one canonical slot: one token claim and one admission;
2. two concurrent lock-held conditional updates: one winner, one stale-token conflict, with no overwrite;
3. repeated startup/tick, multiple tasks, UTC clock edges, out-of-order candidates, and genuinely missed slots;
4. conditional update mismatch, late callback, malformed record, unsafe path, and successor protection;
5. synchronous pre-invocation rejection versus ambiguous synchronous throw; only proven pre-invocation failure retries;
6. crash/failure after admission before `host_called`: slot remains uncertain and restart does not resend;
7. host-call return versus provider-delivery uncertainty is represented without false success;
8. approval pending, same-token approve/resume, duplicate resume, reject, defer, restart, and no-send-before-approval;
9. T-795 shared-store confinement tests and explicit residual TOCTOU documentation;
10. focused tests, full checks/tests, and architecture/docs review with no fitness exemptions.

## Documentation gate

Before implementation merge, retain the evidence record, independent review, and the relevant Mermaid C4/data-flow model in `docs/architecture.md` showing scheduler → slot transaction → approval/admission → host call and the uncertain blocked terminal. ADR-060 is indexed; these documentation changes do not constitute merge approval.
