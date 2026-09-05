# T-888 scheduler slot admission plan

Status: **IMPLEMENTATION IN PROGRESS — bounded ADR-060 slices authorized**
Governing design: [ADR-060](../adr/060-coas-scheduler-slot-admission.md). Safety gate: [T-888 ADR-060 safety recheck](file:///tmp/t888-adr060-safety-recheck.md) — PASS for bounded implementation resumption (not merge approval).

## Problem and boundary

`CoasInternalScheduler.start()` performs catch-up on every boot while `lastRun` and `activeRuns` are process-local. The canonical occurrence is `(taskId, UTC minuteKey(occurrence))`.

Use the existing shared `ConfinedStore` and its T-795 narrow defense-in-depth checks. Do not claim TOCTOU elimination, add a second confinement layer, or perform a broad race-resistant filesystem redesign.

The current five-minute stale-claim deletion is rejected: an externally handed-off prompt can be duplicated after the claim is removed. No age- or PID-based takeover is allowed.

## State and transaction contract

A slot record is bounded and secret-free. It includes task ID, UTC slot key, status, timestamps, opaque claim token/generation, and attempt identity; never prompt/provider/credential data.

The complete state graph is:

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

`reserved`, `approval_pending`, `admitted`, `host_called`, `host_call_returned`, and `uncertain` block automatic re-admission/retry. `failed_pre_handoff` is the only automatically retryable result. Rejected/deferred are terminal no-send outcomes for this slot; a later occurrence has a new slot identity. `host_call_returned` is not provider delivery confirmation. `uncertain` remains blocked.

### Lock-held conditional update

Initial `reserved` creation is exclusive. Every later transition is a per-slot lock-held CAS:

1. acquire the uniquely scoped advisory lock through the shared confined store;
2. reread the current record while holding the lock;
3. validate task/UTC-slot identity, bounded shape, exact token/generation, and expected status;
4. atomically write the next record while still holding the lock, or return conflict/no-op;
5. release only after the replacement is durable.

Atomic rename alone is insufficient: it gives complete-file visibility but does not serialize two readers deciding from the same old record. Key-only `markDelivered`/`markFailed` APIs are prohibited.

## Handoff/admission rule

Admission is the duplicate-prevention boundary:

1. validate token, slot, schedule eligibility, and approval state;
2. commit `admitted` and attempt identity through the lock-held CAS;
3. release the lock;
4. invoke the host.

A synchronous throw is retryable only when the adapter demonstrably proves `handoff: "not-started"` before invocation. A throw at or after the ambiguous host boundary is `uncertain`; it is never automatically retried. A crash after admission before `host_called` persistence is also uncertain. Host-call return records host-call state only, never provider delivery.

## Approval integration

Approval is first-class:

1. reserve the slot and create/reference an approval artifact containing the same slot identity and token/generation;
2. persist `approval_pending`; send nothing;
3. on authorized approval, reread under the same per-slot lock and CAS that exact record from `approval_pending` to `admitted`;
4. invoke the host once outside the lock;
5. rejection/defer are explicit terminal no-send outcomes.

Approval creation and pending-state persistence must be coordinated by the same token/slot boundary. If separate bounded files cannot be atomically committed, an orphan artifact is inert. Duplicate/stale resume is conflict/no-op and cannot create a second claim. No approval path retries uncertainty.

Do not let a generic truthy executor result mark parked approval or dispatch pause as delivered.

## Uncertainty and recovery

A reserved/admitted/uncertain slot blocks repeated dispatch across restart. Remove the five-minute stale retry. Do not add generic recovery UI, automatic deletion, PID checks, or a lease service. Existing bounded diagnostics may surface the blocked occurrence; safe authorized operational intervention is required, otherwise it remains blocked.

## Ordered implementation slices

Implementation record (canonical slice order; update evidence here before source changes):

- [x] Slice 1 — pure state contract
- [x] Slice 2 — confined exclusive reservation and CAS
- [x] Slice 3 — handoff/admission seam
- [x] Slice 4 — approval lifecycle
- [x] Slice 5 — catch-up/restart integration
- [x] Slice 6 — docs/evidence gate (full checks/tests and fresh independent diagnostics completed)

The pre-existing T-888 prototype artifacts are preserved and revised in place. T-795 is used only as the shared `ConfinedStore` boundary; no competing implementation is copied. Integration delta: this work adds per-slot lock-held conditional transitions and fail-closed uncertainty semantics around the existing persistence API.

### Slice 1 — pure state contract

Files: `scheduler-slot-state.ts`, slot types, focused reducer/serialization tests.

Implement canonical key validation, complete status transitions, token/generation, malformed-record fail-closed behavior, and explicit applied/conflict results. No scheduler wiring.

Acceptance: deterministic transition matrix passes; invalid status/token/order cannot mutate; no age/PID reclaim exists.

### Slice 2 — confined exclusive reservation and CAS

Files: `scheduler-slot-state.ts`, shared `ConfinedStore` call sites, slot persistence tests.

Implement exclusive `reserved` creation and lock-held read/validate/atomic-write transitions under `schedule-runs`. Reuse T-795's shared store; no copied security helper.

Acceptance: two independent processes admit one reservation; two concurrent updates yield one winner and one stale-token conflict; path/symlink/non-regular failures fail closed; late token cannot update a successor.

### Slice 3 — handoff/admission seam

Files: `scheduler-run-queue.ts`, `scheduler-run-once.ts`, `scheduler-dispatch.ts`.

Separate reservation, approval, admission, host call, and outcome reporting. Define the executor result with explicit handoff state; do not use generic boolean truthiness for delivery. Retry only a demonstrably pre-invocation failure.

Acceptance: ambiguous throw and crash after admission remain blocked/uncertain; only proven pre-handoff failure is retryable; provider delivery is never claimed.

### Slice 4 — approval lifecycle

Files: `scheduler-approval.ts`, `scheduler-resume.ts`, `scheduler-run-state.ts`, slot tests.

Bind approval artifacts to the slot token/generation; coordinate pending state; approve/resume performs the same-token CAS to admission; reject/defer are terminal no-send outcomes.

Acceptance: no prompt before approval; restart-safe approval resume admits once; duplicate/stale resume conflicts; parked approval is not falsely marked delivered.

### Slice 5 — catch-up/restart integration

Files: `scheduler.ts`, `scheduler-run-queue.ts`, `scheduler-slot-state.ts`, catch-up tests.

Wire all boot/tick paths to canonical slot reservation and remove stale-age deletion. Preserve cron defaults, queue reconciliation, continuation behavior, and delivery guards except for the explicit outcome contract.

Acceptance: existing restart/repeated-slot/multi-task/clock-edge/out-of-order/missed-slot tests pass; two scheduler processes produce one admission; uncertain slots are not resent.

### Slice 6 — docs/evidence gate

Files: implementation report, `docs/adr/README.md`, relevant Mermaid model in `docs/architecture.md`.

Record uncertainty, host-call/provider-delivery limits, approval state, T-795 confinement boundary, exact focused/full validation, and the lock-held CAS evidence. Add ADR-060 to the index and show the slot transaction/data flow in C4/architecture documentation.

Acceptance: safety recheck passes the exact ADR; no source/test edits proceed before that recheck; no fitness exemptions.

## Deterministic test matrix

- Same task/UTC slot, two processes: one exclusive token claim/admission.
- Two concurrent conditional updates: one lock-held CAS winner, one stale-token conflict, no overwrite.
- Same process repeated catch-up and restart: no duplicate admission.
- Different tasks sharing a minute: independent admissions.
- Clock edge, out-of-order older tick, and genuinely missed slot.
- Conditional update with stale token/generation, malformed record, successor replacement, and late callback.
- Failure proven before host invocation: retry allowed.
- Synchronous throw at/after ambiguous host boundary: uncertain and blocked; no automatic retry.
- Crash after admission before status acknowledgement: no replay on restart.
- Host call return: record host-call outcome only, never provider delivery.
- Approval pending, same-token approve/resume, reject, defer, restart, duplicate/stale resume, and no-send-before-approval.
- Shared `ConfinedStore` symlink/non-regular/confinement cases, with residual TOCTOU explicitly accepted.
- Existing continuation, delivery guard, quota, drift, and scheduler lifecycle behavior.

## Current disposition

The implementation report's passing tests establish useful exclusive-file and deterministic catch-up behavior, but do not approve the five-minute takeover or current approval/uncertainty semantics. Preserve the existing red/uncertainty cases and stop for exact ADR-060 safety recheck before builder resumption.
