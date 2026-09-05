# T-886 transaction migration

## Slice 1 — revision-bearing transaction seam

Implement only the persistence seam. Ownership/driver wiring remains a later slice.

- `GoalState.revision` is the sole authoritative monotonic revision; no redundant snapshot revision wrapper.
- The seam accepts `GoalState | null` and an explicit expected current (`"absent"` or `{goalId, revision, owner?}`). Owner-controlled mutations require `{token, generation}`; omission is only for creation or explicitly authorized non-owner transitions.
- The pure synchronous reducer is bounded and non-reentrant: no await, promise, filesystem, UI, provider, timer, callback, or nested transaction.
- The transaction returns a discriminated result: applied (`state: GoalState | null`, `projection: complete|failed`, bounded projection error) or conflict (`actual: GoalState | null`), with malformed/unsafe/pre-commit I/O failures rejected separately.
- Authority commits under the existing confined advisory lock before projections. Projection failure is reported as applied/projection-failed, never as conflict or full success. Delete returns applied with `state: null`; cleanup never recreates or removes siblings.
- Legacy reads parse an in-memory revision `0` and do not rewrite authority as a read side effect. First successful mutation writes revision `1`; invalid revision values fail closed.
- Existing callers may use an explicitly named expected-revision adapter only on this uncommitted migration branch. It is discriminated, never permissive, never silently overwrites, and has a removal checklist. It must not remain in a final commit.

## Temporary adapter removal checklist

- [x] Migrate every pi-goal command/tool/watchdog/lifecycle/replacement caller to the transaction seam.
- [x] Remove the adapter and all arbitrary snapshot `saveGoal(state)` writes; test setup uses `tests/fixtures/goal-state.ts` and the real transaction.
- [x] Verify zero production `saveGoal`/unchecked `clearGoal` references; knip passes.
- [x] Preserve deliberate raw legacy fixtures; normal fixtures use revision transactions.

Current evidence and remaining release gates: `docs/reports/t-886-final-validation.md`.

## Ownership slice progress

- Claim, admission, revoke, and exact-token release now use `transactGoal` with authoritative revision CAS.
- `ownerGeneration` is retained after release/revoke to prevent ABA generation reuse.
- Duplicate-driver and stale-admission regressions pass; watchdog remains owner-gated. No TTL/dead-owner takeover is implemented.
