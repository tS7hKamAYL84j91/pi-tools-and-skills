# T-886 ADR-059 ownership/admission slice

Status: active

Historical worker-stage evidence, before GM integration. See `t-886-final-validation.md` for current status.

Date: 2026-09-05
Status: coherent slice frozen for independent review; **not full ADR-059 acceptance**.

## Scope

This report covers the ownership/admission implementation only. Caller-migration history remains in `t-886-caller-migration.md`, which explicitly excludes ownership.

## Tests-before-fixes (RED)

Before the ownership changes, the retained duplicate-driver regression was active and failing:

```text
npm test -- --run tests/goal/pi-goal-transaction.test.ts tests/goal/t-886-baseline-regressions.test.ts tests/goal/t-886-caller-migration-regressions.test.ts
1 failed, 28 passed, exit 1
failure: prevents two independent drivers from steering one persisted goal (expected sends 1, received 2)
```

No test was skipped or weakened.

## Implemented contract

- `claimGoal` performs a lock-protected `transactGoal` CAS and admits exactly one unowned driver.
- Claims use opaque tokens and monotonically increasing generations. `ownerGeneration` is retained after revoke/release to prevent ABA reuse.
- `admitGoal` rereads authority, requires the exact owner, an active run, and a valid attempt, then records the admission before host delivery.
- `revokeGoal` invalidates the exact owner generation and stops the run. `releaseGoal` clears only the exact token/generation and cannot affect a successor.
- Run-loop sends are admitted before host calls; stale post-await state uses returned authoritative state and owner/revision checks.
- The watchdog ignores unowned runs; it does not acquire ownership or perform dead-owner/TTL takeover.
- Existing SDK semantics are preserved: initial `ExtensionAPI.sendUserMessage` remains a void call; replacement-session sends remain awaited promises.

## Prior ownership+driver PASS evidence

The prior bounded ownership+driver slice passed independent review after the watchdog correction. Its historical evidence was 4 watchdog tests, 88 goal tests, `tsc` exit 0, and `knip` exit 0. The duplicate-driver regression remains green and unskipped. This section is historical; the replacement-reservation correction is reported separately below.

## Bounded watchdog correction evidence

Pre-fix RED (reproduced three times by independent review): `npx vitest run tests/goal/pi-goal-continuous-liveness.test.ts` — 3 passed, 1 failed, exit 1 (`nudges` remained 0).

Post-fix GREEN:

```text
npx vitest run tests/goal/pi-goal-continuous-liveness.test.ts
4 passed, exit 0

npx vitest run tests/goal
11 files, 88 tests passed, exit 0

npm run check
exit 0 (typecheck, knip, type-coverage 99.23%; existing lint warnings/infos)
```

No test was weakened or skipped. The watchdog fix was limited to the failed admission/import path; subsequent replacement correction is recorded below.

## Replacement handoff correction

A RED regression was then added for cancellation during replacement handoff: the pre-fix run sent once instead of zero (`npm test -- --run tests/goal/t-886-baseline-regressions.test.ts -t "does not send a replacement turn after cancellation during handoff"`, exit 1). The bounded fix checks cancellation inside `withSession`, settles the waiter, releases the exact owner, and avoids the stale replacement send. Post-fix focused result: **1 passed, 10 skipped, exit 0**; full goal suite: **11 files, 90 tests passed, exit 0**. Durable shutdown ordering and full reservation handoff validation remain incomplete and are not claimed accepted.

## Regression matrix

Covered by the current focused tests:

- Competing claims and duplicate drivers: one admitted driver; loser observes conflict.
- Token/generation admission: stale token conflicts; replacement generation increases after revoke/release.
- Revoke/release: exact-token conditional behavior; stale finalizers cannot clear a successor.
- Pre-admission cancellation: failed/stale admission prevents the host call.
- Post-admission cancellation residual: admission is persisted before host delivery; later revoke prevents subsequent admissions but cannot retract an already admitted SDK call.
- Stale-await containment: runtime failures reload current authority before interruption persistence; stale revision writes conflict.
- Owner-only watchdog: unowned watchdog activity is ignored; explicit owner fixtures cover warning, idle nudge and hard-timeout behavior.
- Replacement send failure and cancellation: existing run-loop regressions remain green for awaited replacement-session failures and cancelled sessions.

## Remaining ADR-059 matrix

Not claimed complete in this slice:

- Full owner-associated watchdog token revalidation immediately before nudge, including competing watchdog processes.
- Dedicated shutdown-old-local-only ordering tests and complete durable replacement-intent handoff validation.
- Exhaustive post-admission cancellation races across process boundaries and host scheduling.
- Every lifecycle/tool/watchdog mutation independently audited for owner CAS after each await.
- Malformed ownership repair guidance, path/inode race fixtures, and explicit operator recovery workflow.
- Full child-process/process-death exclusion evidence and C4 architecture review.

No automatic TTL, dead-owner takeover, or invented host API was added.

## Replacement-review correction evidence

The reviewer-reported pre-correction replacement command was 3 passed/9 skipped (exit 0). Current executed replacement command was `npm test -- --run tests/goal/t-886-baseline-regressions.test.ts -t "replacement"`: **3 passed, 9 skipped, exit 0**. Reservation consumption now validates exact owner, generation, attempt, and reservation revision in a transaction before the awaited replacement send; successful consumption clears the reservation. Full goal suite remains **90 passed, exit 0**. This remains a bounded partial slice, not release or full ADR acceptance. The prior watchdog/lifecycle admission observations are superseded by the corrected source and are not current findings. Remaining work is limited to the explicitly listed replacement shutdown/identity, waiter settlement, process/confinement, and operator-recovery matrix.

## `saveGoal` adapter status

The compatibility `saveGoal` export remains for existing tests/raw fixtures on this uncommitted branch. Production pi-goal callers migrated to transaction-based mutation; fixture migration and the zero-reference/removal checklist remain before finalization. Compatibility is intentionally not removed while references remain.

## Replacement reservation independent review

Read-only Luna recheck: **REVISE** (`/tmp/t886-replacement-review.md`). Executed replacement focus: 3 passed / 9 skipped, exit 0; whole goal suite: 11 files / 90 passed, exit 0. Reservation consumption is now atomic and exact-owner/generation/attempt/revision checked before awaited replacement send. Remaining bounded findings are (1) no independent callback/new-context identity validation and (2) old-session shutdown still uses global runtime cancellation without reservation-aware old-vs-new scoping or a regression proving successor preservation. Candidate remains frozen; no further implementation started.

No commits, pushes, live goals, provider/config/settings actions, or unrelated edits were performed.
