# T-872 Validation Gates — Findings Report

- **Date:** 2026-08-28
- **Result:** PASS — no defects open. One real defect found and fixed during the gauntlet (lease double-grant under concurrent grants; fixed by the queue mutation lock).
- **Commits:** gauntlet fixtures + fix in the T-872 commit on pi-tools-and-skills@main.
- **Scope:** design doc section 11 acceptance rows 1–15, mapped to their test surface below.

## Row mapping (design doc section 11)

| Row | Gate | Test surface | Result |
|---|---|---|---|
| 1 | exactly-once under lease model | `daemon-t872-gates.test.ts` concurrent lease-grant fixture; `daemon-queue.test.ts` lease walk | PASS (after fix) |
| 2 | dedupe under idempotency replay | `daemon-queue.test.ts` replay + prior-outcome; `daemon-t872-gates.test.ts` (implicit) | PASS |
| 3 | dead-letter on tamper/expiry | `daemon-queue.test.ts` tamper/expiry; `daemon-t872-gates.test.ts` expiry fixture | PASS |
| 4 | idempotent crash recovery | `daemon-queue.test.ts` recovery idempotence; `daemon-t872-gates.test.ts` crash fixtures | PASS |
| 5 | corrupt-tail quarantine | `daemon-t872-gates.test.ts` schedule-state corrupt fixture; recovery tamper fixture | PASS |
| 6 | guard-drift fail-closed | `daemon-t872-gates.test.ts` guard-drift fixture; `daemon-serve.test.ts` non-root drop | PASS |
| 7 | same_uid label in audits | `daemon-serve.test.ts` + delivery audit events carry `posture` | PASS |
| 8 | admin op via agent socket rejected | `daemon-admission.test.ts` + admin.ts fail-closed | PASS |
| 9 | generation-boundary continuity | `daemon-queue.test.ts` generation-mismatch dead-letter | PASS |
| 10 | name-reuse isolation | `daemon-registry.test.ts` name-reuse mints new agent_id | PASS |
| 11 | kill -9 mid-tick: claim w/o envelope | `daemon-t872-gates.test.ts` cycle-lost fixture | PASS |
| 12 | offline recipient reconnect | `daemon-queue.test.ts` parked no-burn + `daemon-t872-gates.test.ts` redelivery fixture | PASS |
| 13 | writer-lease restart window | `daemon-schedule-tick.test.ts` restart re-arm + grace suppression | PASS |
| 14 | late ack after dead_letter | `daemon-queue.test.ts` terminal no-op audit | PASS |
| 15 | SIGSTOP recipient | `daemon-serve.test.ts` hung-recipient fixture (other deliveries proceed) | PASS |

## Defect found and fixed

- **Lease double-grant (row 1):** two concurrent `grantLease` calls could both
  win (TOCTOU between record read and persist). Fixed with a queue mutation
  lock serializing all state transitions (single-process daemon); the
  concurrent fixture now asserts exactly one lease.

## Residual advisories (non-blocking, tracked)

- A3 dead-letter quarantine cross-ref; A4 quarantine rename-failure audit
  (fixed in b5bc6ca); A5 policy docstring; A6 symlink-following reads;
  A8 parked-budget counter drift; A9 audit fsync mode. None violate ADR
  sections 3–6 (t869/t868 reviewer dispositions).

## Gate disposition

All gates PASS. T-873 rollout work-orders may be routed to Gravitas for
authorization (each step separately authorized per ADR-0008 decision 8).