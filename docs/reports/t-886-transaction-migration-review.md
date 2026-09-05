# T-886 transaction-migration plan safety review

Status: active

Historical stage verdict; see `t-886-final-validation.md` for current status.

Date: 2026-09-05
Reviewed: `docs/plans/t-886-transaction-migration.md` against `docs/adr/059-goal-driver-ownership.md`
Disposition: **REVISE — seam-first design is sound after the blocking corrections below**

No source edits or implementation were made. The duplicate-driver regression remains intentionally red and must remain so through Slices 1–5; this review does not treat it as a reason to skip the persistence seam, and does not approve ownership implementation.

## Decision

The plan correctly starts with a lock-protected revision transaction rather than a local run-loop claim. It correctly keeps provider/gate/UI/replacement awaits outside the lock, requires reread/CAS after awaits, preserves `milestoneRevision` for evidence correlation, and selects explicit operator recovery rather than automatic PID/TTL takeover.

It is not ready for seam-first implementation until the API/result shape, staging rule, deletion/projection outcomes, owner identity, reducer reentrancy, and legacy read semantics are made exact.

## Blocking corrections

### 1. Resolve Slice 1's staging contradiction

The plan's Slice 1 acceptance says “no production caller still depends on a void arbitrary snapshot save,” while Slices 2–5 explicitly migrate those production callers. The current source confirms the contradiction: `extensions/pi-goal/goal-persist.ts:saveGoal` is a `Promise<void>` arbitrary snapshot writer and commands/tools/run-loop/extension/watchdog still call it.

Replace the Slice 1 acceptance with:

- Slice 1 leaves existing callers temporarily compiling through an explicitly named compatibility adapter **only on the uncommitted integration branch**.
- The adapter must require an expected revision/snapshot, return the discriminated transaction result, and reject/flag calls that do not supply one; it must not be a permissive `saveGoal(state)` path.
- No temporary adapter may be committed, released, or retained as a production escape hatch. Slices 2–5 remove every caller; the final Slice 5/6 gate must assert zero production references to the adapter and zero void snapshot writes.
- Test-only legacy fixtures may write deliberate raw legacy JSON, but ordinary fixtures must use the transaction/creation seam.

This permits incremental migration without weakening the final contract.

### 2. Prefer revision-bearing `GoalState`; remove redundant snapshot duplication

ADR-059 requires one authoritative monotonic revision. The plan's `GoalSnapshot { state, revision }` duplicates the revision concept if `GoalState` already carries `revision`, and increases the risk that wrapper and state diverge. Prefer `GoalState.revision` as the sole revision-bearing representation, with `GoalState | null` for the current/deleted authority.

A safe concrete shape is:

```ts
interface GoalExpectedCurrent {
  readonly goalId: string;
  readonly revision: number;
  readonly owner?: GoalOwnerIdentity;
}

type GoalExpected = "absent" | GoalExpectedCurrent;

interface GoalOwnerIdentity {
  readonly token: string;
  readonly generation: number;
}

interface GoalMutationApplied {
  readonly status: "applied";
  readonly previousRevision: number | "absent";
  readonly state: GoalState | null; // null means authority was deleted
  readonly projection: "complete" | "failed";
  readonly projectionError?: string;
}

interface GoalMutationConflict {
  readonly status: "conflict";
  readonly expected: GoalExpected;
  readonly actual: GoalState | null;
}

type GoalMutationResult = GoalMutationApplied | GoalMutationConflict;
```

The exact names may vary, but the implementation must not return a normal applied result with an impossible non-null snapshot for delete, nor overload `null` so callers cannot distinguish deletion from absent conflict. `actual: null` in a conflict means current authority is absent; `status` remains the discriminator.

If the implementation retains a wrapper for scope or immutable attempt metadata, it must derive all revision/identity fields from `GoalState` and must not create a second revision source.

### 3. Make authority/projection outcome explicit, including delete

The transaction commits `goal.json` authority before rebuilding derived files; those files are not multi-file atomic. The result must therefore distinguish:

- conflict before authority commit;
- applied creation/update with all projections complete;
- applied creation/update where authority committed but projection regeneration failed;
- applied delete where authority was removed but cleanup/projection removal failed;
- malformed/unsafe/I/O failure before authority commit (reject/fail closed, not conflict).

Do not silently reject an authority-committed result as if no mutation happened, and do not report full success when projections failed. A practical result can retain `status: "applied"` with `state: GoalState | null` plus `projection: "complete" | "failed"` and bounded `projectionError`; a separate `GoalDeleteApplied` is also acceptable. Callers must branch on both `status` and projection outcome.

For delete, define the authority precisely: remove only the bound canonical instance after owner/revision validation; never recreate it from a late callback. If cleanup cannot be safely completed, return authority-deleted/projection-failed and refuse unsafe recursive cleanup. Siblings and unrelated legacy files remain untouched.

### 4. Require expected owner identity as a first-class CAS predicate

The plan says owner token/generation are validated “when supplied,” but the concrete expected type must make this unavoidable for owner-controlled paths. For an owner mutation, require `{goalId, revision, owner: {token, generation}}`; omission is allowed only for explicitly non-owner mutations such as initial creation or an authorized command transition whose contract says it revokes/claims ownership.

A mismatch in goal ID, revision, token, or generation is a conflict/no-op, never a stale write. The reducer must not be handed a caller-owned stale state. Send admission, revocation, release, continuation handoff, post-turn accounting, watchdog nudge, and failure containment all need the same predicate.

### 5. State the reducer and lock non-reentrancy rule

The plan correctly requires a synchronous reducer, but add an explicit deadlock rule:

- reducer is pure, synchronous, bounded, and cannot call `loadGoal`, `saveGoal`, `transactGoal`, filesystem APIs, UI, provider/gate code, timers, or callbacks;
- no await, promise creation, callback into extension code, or nested transaction occurs while the state lock is held;
- projection rendering/writing uses the committed result without re-entering the transaction; projection failure is captured as an outcome after authority commit;
- lock release remains in `finally`, including reducer, authority-write, and projection exceptions.

This prevents a reducer from recursively acquiring the same advisory lock or awaiting an operation that needs the transaction to finish.

### 6. Preserve legacy read behavior without read-side authority mutation

For a valid legacy state with no `revision`, parse an in-memory logical `revision: 0` and mark only internal read metadata if needed. A read-only `loadGoal` must not write a normalized authority revision merely because it regenerated projections. The first successful revision transaction writes revision `1`; two first mutations from logical revision `0` yield one applied and one conflict.

Keep this distinct from ADR-051's explicit scoped legacy-layout claim/migration: that migration may create the bound instance and binding under its migration lock, but revision normalization must not be an incidental read-side write. A legacy read must continue to return the same usable goal state/projections and preserve unknown legacy files. Invalid present revision values (negative, fractional, non-numeric) fail closed rather than becoming revision 0.

Update existing legacy tests that currently expect `loadGoal` to rewrite `goal.json`; retain tests that verify legacy state remains readable until a real mutation and that first mutation is revision-checked.

## Non-blocking design confirmations

- **No automatic recovery:** the plan matches ADR-059. No PID identity service, TTL, lease, daemon, or age-based takeover is needed. Explicit authorized pause/stop/clear revokes generation; explicit run/resume waits for the recovering local host to be idle. Remote admitted-turn ambiguity remains documented.
- **No lock over external work:** gate commands, provider sends, UI, `waitForIdle`, `newSession`, replacement callbacks, and host callbacks stay outside the lock. Results re-enter through expected revision/owner CAS.
- **GoalState preference:** one `revision` field is sufficient; do not add a redundant wrapper unless it carries non-duplicative capability/scope data.
- **Red test preservation:** `tests/goal/t-886-baseline-regressions.test.ts` duplicate-driver assertion remains red through Slices 1–5 and becomes the ownership-slice acceptance signal, with no skip or fitness exemption.
- **No broader schema/services:** revision and bounded ownership/attempt fields remain part of the existing goal authority; no separate service, sidecar, dependency, or automatic recovery mechanism is introduced.

## Seam-first acceptance matrix

Before advancing beyond Slice 1:

1. Current, absent, legacy, and malformed revision parsing is tested; read-only legacy load does not rewrite authority.
2. Two expected-revision mutations from one source revision yield exactly one applied result and one conflict.
3. Creation with `expected: "absent"` cannot overwrite existing authority.
4. Applied update, applied delete, authority-committed/projection-failed, conflict, malformed/unsafe, and pre-commit I/O outcomes are distinguishable.
5. Owner identity mismatch is a conflict and cannot refresh UI, settle admission, or continue with the candidate state.
6. Reducer reentrancy/await is structurally prohibited and lock release is tested on every exception path.
7. Temporary compatibility use is confined to the uncommitted integration branch and has a removal checklist; no final production caller uses it.
8. Raw legacy fixtures remain deliberately raw; normal fixtures use the real creation/transaction seam.

Before ownership/admission implementation is accepted:

- all mutator inventory entries have migrated off arbitrary snapshot saves;
- every post-await write uses applied revision plus owner/generation/attempt identity;
- replacement and watchdog paths use the same seam;
- duplicate-driver test passes with one admitted send attempt;
- ADR-049/051/055, full goal tests, checks, and independent implementation review pass.

## Final verdict

**REVISE.** Approve the plan's seam-first direction for implementation planning, but apply the six blocking corrections above before Slice 1 begins. The actionable next step is to implement and test the smallest revision-bearing transaction seam and its discriminated results, using only a temporary uncommitted compatibility adapter while callers migrate. Do not implement ownership, add services, alter recovery policy, or relax the retained duplicate-driver test until that seam is proven.
