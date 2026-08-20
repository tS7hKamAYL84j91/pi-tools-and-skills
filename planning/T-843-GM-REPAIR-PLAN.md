# T-843 GM Repair Plan

## Target

Implement the host-injected live boost bridge in this clean worktree only. The normal extension path must remain inert; no Q record, provider configuration, schedule, or root model default may be changed.

## Defects to prevent

1. Store mutations must use a **shared durable CAS boundary**, not only an in-process mutex.
2. Any failed restore, audit, cleanup, revoke marker, or shutdown-marker write must leave a durable fail-closed blocked-subject marker.
3. Q revoke must invalidate the active generation before aborting so a racing terminal callback cannot settle or consume it.
4. All added code must pass Biome without suppressions.

## Acceptance criteria

- Concurrent independent store instances sharing one WAL produce at most one reservation.
- WAL failures during every fail-closed transition preserve or establish a durable block; subsequent dispatch denies.
- A terminal callback racing revocation is stale and cannot consume a yield; revocation completes exactly once.
- Normal `ExtensionAPI` loading returns a visible inert denial and exposes no config, credential, scheduler, or Q-mutation surface.
- Focused bridge/store tests, `npm run check`, `npm test`, `git diff --check`, and a fresh exact review pass before commit/handoff.

## Review sequence

1. Define the host-only contracts and deterministic WAL/CAS test host.
2. Implement durable store and lifecycle finalizer with the four safeguards.
3. Wire the optional injected bridge while retaining the inert default.
4. Run focused tests and formatting, then the full quality gates and exact review.

## Baseline evidence

A detached clean `HEAD` worktree at `fb8eb69` ran `npm test`: 1,218 tests passed; it failed the same two docs-hygiene assertions (`docs/reports` has 9 active files against the cap of 8, and `docs/reports/t-761-fire-review.md` is complete). It also had one pre-existing `/boost` registration expectation omission; T-843 corrects that scoped smoke expectation. The repaired worktree ran 1,255 passing tests with only the identical two docs-hygiene failures.
