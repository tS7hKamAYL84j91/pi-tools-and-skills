# T-886 Slice 1 transaction seam final recheck

Status: active

Historical stage verdict; see `t-886-final-validation.md` for current status.

Date: 2026-09-05
Reviewed: updated Slice 1 seam/parser/tests and `docs/reports/t-886-transaction-seam.md` against ADR-059 and the corrected transaction plan
Disposition: **PASS — seam ready for next caller-migration gate**

No source or test edits were made. No ownership wiring was reviewed or implemented. The retained duplicate-driver regression remains deliberately red and is not a Slice 1 seam verdict.

## Evidence

Independent focused run:

```text
npx vitest run tests/goal/pi-goal-transaction.test.ts
1 file: 10 passed
```

Reported companion evidence:

```text
tests/goal: 76 passed, 1 known duplicate-driver failure
npm run check: PASS
```

The known driver failure is deferred to the ownership/admission slice and remains required evidence there.

## Recheck

### Persisted owner identity — PASS

`goal-parse.ts:readOwner` now distinguishes an absent owner from a present malformed record. Null, scalar, missing/empty token, invalid generation, and overlong token fail closed. Valid token text is preserved exactly and generation requires a positive safe integer; no truncation or silent conversion to unowned state remains.

`transactGoal` validates expected goal ID/revision and exact optional owner token/generation before invoking the reducer. `validateReducerOutput` validates the returned owner and rejects removal or identity changes for existing state. The updated persisted-owner table proves malformed records reject, exact valid identity survives load, and an expected-owner mutation applies. This closes the previous schema-dropping blocker.

Intentional owner claim/revoke/transfer remains reserved for the later explicit ownership operation; generic reducers cannot perform it accidentally.

### Goal identity and reducer boundary — PASS

Reducer output for an existing state must retain the canonical `goalId`; invalid IDs or changed identity reject before authority write. The reducer runs only after the lock-held reread/CAS check, and promise-like reducer output is rejected. The reducer-failure follow-up transaction proves lock release. No ownership, external await, UI, or provider work is introduced inside the seam.

### Authority path confinement — PASS for required detected cases

`assertSafeEntry` now checks existing authority entries as non-symlink regular files before read, including flat and ADR-051 instance paths. Updated tests cover both symlinked and non-regular flat/instance `goal.json` entries, so `expected: "absent"` cannot knowingly treat a substituted authority entry as absent.

Deletion checks all known projection paths before removal and uses non-recursive removal. Updated tests cover symlinked and directory projection substitutions and verify the result is authority-applied/projection-failed rather than outside traversal. The accepted residual remains that Node's check/use sequence cannot provide kernel-level protection against every hostile parent-directory replacement; detected unsafe entries fail closed and no stronger guarantee is claimed.

### Revision and legacy behavior — PASS for Slice 1

`readRevision` rejects present null, string, negative, fractional, and other non-integer values; absent revision is logical revision 0. Updated tests cover the malformed revision table. Legacy reads preserve the raw authority bytes and expose revision 0 in memory. The first valid legacy mutation applies at logical revision 0 and writes revision 1; a second mutation using the stale expected revision conflicts. This is actual test evidence, not inferred from the report prose.

### Authority/projection result — PASS

The discriminated result distinguishes conflict from applied mutation, represents deletion with `state: null`, and reports authority committed with `projection: "failed"` plus a bounded sanitized diagnostic when known-file projection work fails. Authority is written before projections, and the tests verify the authority remains committed after projection failure. No multi-file atomicity is claimed.

## Separate migration gate

The seam is ready for the next caller-migration slice. Existing permissive `saveGoal(state)` callers are intentionally not yet migrated and are not evidence of a seam defect. They are a separate final-release blocker: every command, tool, lifecycle, watchdog, replacement, creation, deletion, and containment mutation must move to revision-bearing transactions before ownership/admission wiring or release. Any temporary adapter must remain uncommitted and be removed with zero-reference checks.

The duplicate-driver test must remain active and red through caller migration, then pass only after the later owner claim/send-admission implementation and its race tests are reviewed.

## Final verdict

**PASS — Slice 1 transaction seam.** The previously blocking owner parsing/identity-preservation and authority symlink/non-regular-entry issues are corrected and covered by the 10-test seam suite. Proceed to the explicitly separate caller-migration gate. Do not interpret this PASS as ownership approval, full T-886 acceptance, or release approval.
