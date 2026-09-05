# SAFETY Council Seat: T-795 / T-888 Shared Persistence Boundary

Status: active

Date: 2026-09-05

## Separate verdicts

- **T-795: BOUNDED PASS; INTEGRATION GATE REVISE.** The source supports ordinary substitution/non-regular hardening and resolved-path defense in depth. It must not claim closure of a historically failing symlink gap: the relevant symlink tests are already green on `origin/main`. The check-then-use TOCTOU limitation is explicitly outside the guarantee and must remain documented.
- **T-888: REVISE; INTEGRATION BLOCKED.** Persistent exclusive admission addresses the process-restart duplicate demonstrated by its regression, but the five-minute stale-claim takeover permits duplicate prompts after an external handoff. Tokenless status updates and ambiguous approval/failure outcomes are not safe for integration.
- **Shared boundary: DESIGN GATE REQUIRED BEFORE EITHER INTEGRATION.** Reconcile both branches onto one confined persistence boundary. This is a narrow design gate, not a request for a generic rewrite or an immediate descriptor-relative filesystem redesign.

No source/test edits, commits, pushes, merges, live operations, or provider operations were performed.

## Independent source assessment: T-795

The candidate retains lexical containment and `lstat` component checks, adds resolved-location containment, rechecks recursive directory creation, rejects non-regular read/write substitutions, and rejects symlink directory entries. `ConfinedStore` remains the CoAS boundary. The shared security module has genuine production callers in both `lib/confined-store.ts` and `extensions/pi-coas/store.ts`; its architecture registration is not an exemption. Existing public CoAS store factory and method signatures remain compatible, and external workspace authorization/archive paths remain rooted at the authorized external workspace.

The security claim must be narrow. A disposable `origin/main` copy running the candidate security tests produced **9 passed, 1 failed, exit 1**. The only failure was the new non-regular-directory read assertion (`EISDIR` versus an explicit regular-file error); all tested symlink cases, including the newly-created-descendant case, passed on baseline. Thus the evidence demonstrates non-regular hardening and defense in depth, not a newly reproduced historical symlink escape.

The implementation's `lstat`/`realpath` validation remains check-then-use. A concurrent replacement between validation and filesystem use is possible. That TOCTOU class is outside this bounded ticket guarantee; do not imply race-resistant confinement. The T-795 builder may correct report wording/status only, as scoped; no source change is required by this council seat.

## Independent source assessment: T-888

### Stale lease and external handoff

`claimScheduleSlot` stores `claimed`, `delivered`, or `failed` and uses `writePrivateFileExclusive` for initial create. That is a useful atomic create primitive for same-slot races: only one `open(..., "wx")` succeeds. However, when a `claimed` record is older than five minutes, the code removes it and creates a new claim. A process can have successfully returned from `pi.sendUserMessage` and then die before recording `delivered`; the next scheduler can delete the old claim and send the same prompt again. The implementation report explicitly acknowledges this duplicate window. A timestamp cannot distinguish “never handed off” from “handed off but status persistence was interrupted.”

Reclaim is also not an ownership transition: there is no opaque token/generation in `SlotRecord`, and `markScheduleSlotDelivered`/`markScheduleSlotFailed` identify only `(taskId, slotKey)`. A late old executor can update the successor record after recovery. The current records therefore cannot safely support automatic takeover or late callback handling.

### Failure versus uncertainty

`runOncePerMinute` catches a synchronous `sendUserMessage` throw and returns `reason: "send_failed"`; that is the only path `dispatchScheduledRun` turns into `false`. A normal void return means only that the host call returned without synchronous exception, not that the provider accepted or delivered the message. That boundary must be explicit.

The current dispatch mapping is unsafe for the slot ledger:

- parked approval returns `queued: false`, `reason: "awaiting_approval"`; dispatch does not set `deliveryFailed`, so the queue marks the slot delivered even though no prompt was sent;
- dispatch pause returns `queued: false`, `reason: "dispatch_paused"`; it is likewise marked delivered;
- exceptions caught by `dispatchScheduledRun` are logged and then return success (`!deliveryFailed`), which can also cause `markDelivered`.

The approval resume path checks approval `requestId`/`runId` against run state, but does not participate in a token-conditional scheduler-slot admission transition. Approval is not represented in the slot record. Malformed slot JSON is treated as absent and an existing malformed file may be removed/replaced, which is not fail-closed ledger behavior.

## Minimal requirements before integration

### T-795

1. Reword implementation evidence and acceptance claims as ordinary substitution/non-regular hardening plus resolved-path defense in depth.
2. Keep the explicit TOCTOU limitation; do not expand scope to openat/descriptor-relative redesign.
3. Resolve the architecture documentation fitness failure without an exemption, and retain focused external-root/archive and non-regular tests.

### T-888

1. Keep canonical `(taskId, UTC minute slot)` identity and exclusive initial admission, but add an opaque claim token/generation and bounded secret-free record fields.
2. Remove automatic five-minute stale reclaim. An uncertain claim remains blocking. Recovery must be explicit, operator-authorized, bounded, and conditional on the exact token/record.
3. Make delivered/failed transitions token-conditional; late executors must no-op after recovery or successor admission.
4. Define outcomes at the host boundary: retry only a failure established before `sendUserMessage` was invoked. A void return is “handoff call returned,” not provider acknowledgement.
5. Make approval a first-class protocol state: approve before admission or transition the same token from `approval-pending` to admission immediately before send. Parked, denied, deferred, paused, and resumed outcomes must not be recorded as delivered.
6. Fail closed on malformed/unsafe slot records.
7. Add focused tests for two-process admission, pre-handoff failure, post-handoff crash, late token mismatch, approval park/approve/reject/defer/restart, dispatch pause, and malformed records. Do not treat the existing restart-green test as proof of uncertainty safety.

## Shared persistence integration boundary

T-795 changes `lib/confined-store.ts` and adds shared confinement validation; T-888 independently changes `lib/confined-store.ts` and `lib/file-persistence.ts` to add exclusive creation. Integrate these as one reconciled change, not by choosing one branch wholesale or retaining duplicate confinement implementations. T-888 slot files, scheduler run state, approval artifacts, and archive/context files must all use the selected confined store/root rules. Preserve the exclusive-create primitive, but subject it to the selected ordinary-substitution hardening and retain its check-then-use limits in the contract.

## Design-gate decision

Do not integrate either candidate until:

- T-795 evidence/status is corrected and its bounded claim is accepted; and
- T-888 has an explicit token/lease/approval uncertainty contract and tests, with no automatic stale takeover; and
- the shared `ConfinedStore`/file-persistence boundary is reconciled.

A council/ADR decision is required for that security-material contract before integration. The decision need not authorize a broad rewrite: it should settle the narrow state machine, recovery authority, host-call semantics, and branch boundary above.
