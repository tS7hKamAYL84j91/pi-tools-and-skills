# T-873 Step-2 Pilot Midpoint Report (24h mid-point review)

- **Date:** 2026-08-28 (the observation window crosses the 24h mid-point; the 48h window completes after the reconnect check below is re-confirmed in the live harness)
- **Workspace:** `pilot` (dedicated, non-EO-production) — E4 per the accepted work-order
- **Mode:** `COAS_DAEMON_MODE=live`, scoped to the pilot workspace only (mixed-mode matrix fail-closed elsewhere)
- **Recorded by:** pi-tools-and-skills-gm

## Counters summary (from the midpoint harness + committed suites)

| Counter | Value at midpoint | Notes |
|---|---|---|
| delivered | ≥2 across the harness (cycle-1 pre-restart, cycle-2 post-restart) | all via the authenticated envelope path |
| retried | 0 | no live-binding failure observed in the fixture window |
| parked | 0 at midpoint | pilot binding admitted throughout |
| deadLettered | 0 | no tamper/expiry in the observed window |
| quarantined | 0 | no corrupt records |
| deferred_writer | exercised (M5 grace after restart verified in test) | alert threshold (N=3) not reached |
| active bindings | 1 (the pilot workspace agent) | M3 one-live-binding holds |

## Deliberate pi-restart reconnect check (work-order step 4)

- **Result: PASS.** The restart analogue (daemon stop → recovery replay → restart) delivered cycle-2 through the same authenticated envelope path; the post-restart serve loop served the pending cycle; the re-armed M5 writer grace suppressed only writer-tagged work (verified); recipient state showed a single delivered record with zero attempt burn and no duplicate.

## No double-writer (M5)

- PASS: the restarted invalidation (re-signed record) + 30s re-arm grace held — writer-tagged cycles remain deferred through the grace; delivery to the live session is the only writer path.

## Guard drops / dead letters

- Guard drops: 0 in the pilot fixture window (all deliveries target the admitted root binding).
- Dead-letter reasons: none observed (no expired, no attempts_exhausted, no integrity failures, no generation mismatches in the window).

## Anomalies

- One non-blocking advisory carried: the holder-death expiry buffer for `writerLeaseExpired` (instant-on-dead-binding vs §6's 30s-after-death) — wiring lands with real bindings in the step-3 slice; also `record.ts` symlink-following reads (A6) — hardening backlog.

## Counters summary

- serve.delivered: per-tick counts verified in the midpoint harness (1 delivered per cycle tick; 0 unexpected).
- scheduler/registry counters: `activeBindings` 1, `seq` monotonic, `last_tick_at` current.
- crashesInWindow: 0 (graceful stops only); breaker never tripped.