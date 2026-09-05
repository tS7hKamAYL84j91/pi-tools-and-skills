# T-888 implementation report

Status: active

Implementation and verification are complete; the merge gate remains external.

Implemented against corrected ADR-060 after [safety recheck PASS](file:///tmp/t888-adr060-safety-recheck.md). No commit, push, merge, live schedule, or provider operation performed.

## Delivered

- Replaced timed claims with opaque-token slot records and per-slot `ConfinedStore.withAdvisoryLock()` lock-held CAS (reread, validate, atomic replacement while locked).
- Added fail-closed malformed/successor/stale-token handling and explicit reserved, approval-pending, admitted, host-called, returned, pre-handoff-failed, and uncertain outcomes.
- Added explicit executor handoff outcomes; ambiguous throws and admission crashes remain blocked rather than automatically retried.
- Bound approval artifacts to the same slot token when scheduler-created; resume performs the same-token pending-to-admitted CAS.
- Added deterministic concurrency, stale-token, and malformed-record regressions.
- Added persistent per-task/per-minute slot records in `schedule-runs`.
- Claims use confined exclusive file creation, preventing independent scheduler processes from reserving the same slot.
- Delivery and failure outcomes are persisted atomically; only proven pre-handoff failures are retryable; no age/PID takeover remains.
- Kept approval gating, continuation state, queue reconciliation, cron defaults, and active schedule behavior unchanged.
- Added deterministic restart, repeated-slot, multi-task, clock-edge, out-of-order, and missed-slot regressions.

## Regression evidence

Before this bounded correction, the approval-resume regressions failed as expected:

- `npx vitest run tests/coas/pi-coas-approval-inbox.test.ts`: 2 failed — success stopped at `admitted` and an ambiguous throw stopped at `admitted` instead of `uncertain`.

The correction preserves the approval claim token, performs the same-token `approval_pending → admitted → host_called` transitions before invoking the host, and records either `host_call_returned` or `uncertain`. A duplicate resume cannot pass the slot CAS and no uncertain outcome is replayed.

The focused suite now passes:

- `npx vitest run tests/coas/pi-coas-scheduler-slot-admission.test.ts tests/coas/pi-coas-scheduler-spawn-catchup.test.ts tests/coas/pi-coas-scheduler-approval.test.ts tests/coas/pi-coas-approval-inbox.test.ts tests/coas/pi-coas-scheduler-should-run.test.ts`: 29 passed.

## Validation

Freshly executed for this correction:

- `npm run check`: PASS — typecheck, namespace/template checks, knip, lint (25 warnings/89 infos, no errors), and type coverage 99.23%.
- `npm test`: PASS — 210 files, 1,559 tests.
- Focused approval/slot suites: PASS — 29 tests.
- `git diff --check`: PASS.
- Primary LSP diagnostics: PASS — 0 findings on edited source/test files.
- `lens_diagnostics mode=all`: 0 blocking findings; one markdown spacing warning was corrected.

Inherited baseline evidence (not re-run for this correction): bounded redacted diff secret scan PASS; no token/key/private-key matches. No live schedule, provider, daemon, root worktree, Kanban, dependency, settings, or default changes.

## Crash and uncertainty limits

Admission is persisted before `sendUserMessage`. A synchronous throw is classified as ambiguous unless the host proves handoff was not started; it becomes `uncertain` and is never automatically retried. A crash after admission leaves the slot blocking on restart. Host-call return is recorded only as host-call state, not provider delivery acknowledgement. The state contains only bounded task/slot/status/timestamps/token data and no prompt or provider secret.

## Review gates

This candidate implements the accepted ADR-060 no-takeover/token-CAS design. Age is diagnostic only; there is no stale-claim lease, PID takeover, timed retry, or automatic replay of ambiguous outcomes. Independent review remains required before integration. No commit, push, merge, or live activation was performed.
