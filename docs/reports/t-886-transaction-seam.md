# T-886 transaction seam evidence

Status: active

Historical stage evidence; see `t-886-final-validation.md` for current status.

Date: 2026-09-05
Scope: ADR-059 Slice 1 only; no owner/driver/watchdog wiring.

## Plan correction

`docs/plans/t-886-transaction-migration.md` incorporates all six corrections from `t-886-transaction-migration-review.md`:

- revision-bearing `GoalState` as the sole revision source;
- discriminated applied/conflict results with `state: GoalState | null` and projection outcome;
- explicit owner CAS shape;
- pure synchronous/non-reentrant reducer rule;
- legacy read without incidental authority rewrite;
- temporary-adapter/removal checklist and staged caller migration.

## Implemented seam

`extensions/pi-goal/goal-persist.ts` now provides `transactGoal`:

- uses the existing confined path checks and short advisory lock;
- reads authority under the lock and compares expected `absent`, goal id, revision, and optional owner identity;
- runs a synchronous reducer only after the CAS check;
- increments `GoalState.revision` exactly once for an applied create/update/delete;
- commits `goal.json` before projections;
- returns `applied` with `state`, previous revision, and `projection: complete|failed`;
- returns `conflict` with the expected value and actual authority;
- treats deletion as `state: null` and removes only known projection files;
- releases the lock through the existing `finally` path on reducer/authority/projection failures.

Revision parsing now gives legacy reads an in-memory revision `0`, rejects malformed negative/non-integer revisions, and `loadGoal` no longer rewrites authority as a read-side migration. Existing creation state carries revision `0` until its first transaction.

No temporary compatibility adapter was retained or wired. Existing `saveGoal(state)` callers remain intentionally unmigrated for the next slice; they are not evidence that the seam is safe and must be removed/migrated before ownership implementation is accepted.

## New seam tests

`tests/goal/pi-goal-transaction.test.ts` covers:

- two concurrent expected-revision mutations: one applied, one conflict;
- owner mismatch conflict with reducer not invoked;
- malformed revision rejection;
- legacy read revision `0` with byte-identical authority;
- authority committed with projection failure reported separately;
- deletion returning `state: null`;
- reducer failure followed by successful transaction, proving lock release.

## Exact evidence

```text
npx vitest run tests/goal/pi-goal-transaction.test.ts
1 file: 6 passed

npx vitest run tests/goal
10 files: 72 passed, 1 failed
failure: tests/goal/t-886-baseline-regressions.test.ts
  prevents two independent drivers from steering one persisted goal
  expected sends 1, received 2

npx tsc --noEmit
PASS

npm run check
PASS — namespace, template safety, typecheck, lint, knip, strict type coverage 99.23%
```

## Independent seam review corrections

Added failing repros first, then corrected the reviewed defects:

- reducer output cannot change an existing canonical `goalId`;
- generic reducers cannot remove/change owner identity, and malformed owner token/generation shapes fail closed;
- flat and ADR-051 instance `goal.json` symlinks/non-regular entries are rejected before read, including absent-path checks;
- known projection symlink/directory substitutions during deletion refuse cleanup and return applied authority deletion with `projection: "failed"`;
- projection errors use shared `formatGoalDiagnostic` redaction/normalization;
- legacy reads remain byte-identical and malformed revisions fail closed.

The seam remains generic: intentional owner claim/revoke/transfer is not implemented here. Existing owners must be preserved by ordinary mutations; owner transitions are reserved for the later explicit operation.

Updated seam evidence:

Before the parser correction, the new persisted-owner table had a red case because malformed owner records parsed as unowned and valid tokens were truncated. After the correction:

```text
npx vitest run tests/goal/pi-goal-transaction.test.ts
1 file: 10 passed

npx vitest run tests/goal
10 files: 76 passed, 1 failed
failure: retained duplicate-driver regression (expected sends 1, received 2)

npm run check
PASS — typecheck, lint, knip, strict type coverage 99.23%
```

`readOwner` now distinguishes absent owner from present malformed/null/scalar/empty/overlong owner, preserves exact valid tokens, and requires a positive safe integer generation. The seam tests now include raw-JSON owner tables, valid expected-owner mutation, malformed revision tables, first/stale legacy mutation, flat/instance non-regular authority, and non-regular projection deletion.

The remaining red driver test is deliberately preserved. No ownership, admission, watchdog, replacement handoff, child-process, or stale-await caller migration was attempted in Slice 1.

## Next slice

Migrate every production `saveGoal` caller and mutating tool/lifecycle path to `transactGoal`, including explicit owner CAS and post-await revision checks. Add the required real child-process exclusion, cancellation admission, replacement shutdown, watchdog owner-only, malformed/confined state, and stale-write fixtures before wiring ownership. Remove all arbitrary snapshot writes and do not retain a compatibility adapter in the final change.
