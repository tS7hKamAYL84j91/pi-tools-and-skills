# T-873 Step 1 Work-Order (DRAFT — pending chief-of-staff review)

- **Rollout step:** 1 of 3 — dry-run/claim-check against synthetic fixtures (ADR-0008 decision 8 posture)
- **Authorization status:** Step 1 AUTHORIZED for DRAFTING by Gravitas (chief-of-staff relay, 2026-08-28). **No live activation in this step.** Steps 2 (bounded pilot workspace, live daemon, real schedules) and 3 (broader adoption + coas-pi deprecation) each require explicit Principal authorization via Lumen before execution.
- **Drafted by:** pi-tools-and-skills-gm
- **Prerequisites (all met):** T-866 design doc (Reviewed, dual PASS); T-867–T-871 implementation slices complete; T-872 validation gauntlet PASS (`planning/T-872-VALIDATION-REPORT.md`, 15/15 rows).

## 1. Scope

Run the coas-daemon in the two non-live modes against **synthetic fixture workspaces only** (temp-dir state roots, fixture schedule files — never a real workspace's CoAS home):

1. **`COAS_DAEMON_MODE=dry_run`** — the tick claims due cycles (claim-check written, audit `schedule_claimed_dry_run`) and delivers nothing.
2. **`COAS_DAEMON_MODE=claim_check_only`** — claim-check only: state committed, no delivery, no dry-run audit noise.

No live activation, no real schedule files, no A2A deliveries, no pi sessions touched.

## 2. Execution plan

| Step | Action | Expected state |
|---|---|---|
| 1 | Bootstrap the daemon against a fixture state root (`XDG_DATA_HOME`/`XDG_RUNTIME_DIR` pointed at temp dirs) in `dry_run` mode | Lock acquired, socket published 0600, integrity key loaded, audit `daemon_started` |
| 2 | Install 3 fixture schedules (daily 09:00, `*/15`, hourly) in the fixture schedules dir | `loadSchedules` returns 3; none refused |
| 3 | Fire one tick at a due minute | 3 claim-checks written under `schedule-state/`; audit events `schedule_claimed_dry_run` ×3; **zero deliveries**; `snapshot().mode === "dry_run"` |
| 4 | Fire a second tick in the same minute | `already_claimed` ×3 (M1 coalescing; at-most-once per cycle) |
| 5 | Switch to `claim_check_only`, restart the daemon against the same state root | Recovery replays cleanly; writer-lease invalidation (none held); claims rotate on the next due minute |
| 6 | **Rollback rehearsal:** stop the daemon gracefully; verify | Audit `daemon_stopped`; lock released; crash ladder reset; queues (empty in this step) retained read-only; schedule-state preserved; incumbent in-pi scheduler model untouched |
| 7 | Restart with `COAS_DAEMON_MODE=live` **refused** | Bootstrap throws: live mode is held closed until the T-870 registry seam is wired into main.ts (fail-closed hold, per the T-869 review) |

## 3. Preview counts

- Schedules claimed per tick: exactly the number of due fixture schedules (3 in the plan above).
- Deliveries: **0** in every step (non-live modes only).
- State written: claim-check files + audit log lines only; no queue records, no identity admissions beyond the daemon's own.

## 4. Rollback rehearsal (step 6 detail)

- Graceful stop (`stop()`) releases the lock, resets the crash ladder, and audits `daemon_stopped`.
- Disabling the daemon (removing the flag/unit) returns the workspace to the incumbent in-pi scheduler + Zellij model; durable state is retained read-only.
- In-flight deliveries: none exist in this step (non-live modes never enqueue); the `daemon_disabled` dead-letter path is exercised only by its unit tests here.
- Exit path per ADR-0018: the daemon absorbs only scheduler tick / registry / A2A routing; rollback does not strand agent state.

## 5. Success criteria

- All steps pass with zero deliveries and zero errors.
- Audit trail complete: `daemon_started`, `schedule_claimed_dry_run`/`schedule_claimed`, `daemon_stopped`, and (if exercised) `daemon_disabled` events present and bounded.
- `npm run check` and `npm test` green before and after the rehearsal.

## 6. Abort criteria

- Any state-corruption event → immediate disable via the breaker (`recordStateCorruption`), alert to Principal/Lumen, step aborted.
- Any delivery attempt in a non-live mode → step aborted (that would violate the dry-run contract).
- Chief-of-staff or the Principal may abort at any point; the fixture state roots are disposable.

## 7. Explicitly out of scope (this step)

- Live activation, bounded pilot workspace, real schedules (steps 2/3 — separate Principal authorization).
- coas-pi deprecation (post-parallel-run, Q-coordinated, separate authorization).
- Registry-derived guard-input wiring into live delivery (lands with the T-870 registry seam in step 2).

## 8. Duration and reporting

- Timeboxed: single fixture session, all seven steps, one working session.
- Report: step-by-step results + preview counts + audit excerpts delivered to chief-of-staff; step 2 draft prepared only after step 1 is accepted.

## 9. Execution record (2026-08-28)

| Step | Result |
|---|---|
| 1 | PASS — bootstrap in dry_run, socket 0600, `daemon_started` audited |
| 2 | PASS — 3 fixture schedules loaded, 0 refused |
| 3 | PASS — 3 claim-checks written, 0 deliveries, mode `dry_run` |
| 4 | PASS — `already_claimed` ×3 (M1 coalescing) |
| 5 | PASS — `claim_check_only` restart; quarter-hourly claim rotated to 09:15; 0 deliveries |
| 6 | PASS — rollback rehearsal: lock released, ladder reset, not disabled |
| 7 | PASS — live mode refused (held closed until the T-870 registry seam wiring) |

Deliveries across the entire run: **0**. Gates after execution: 203 test files / 1532 tests, `npm run check` clean.
