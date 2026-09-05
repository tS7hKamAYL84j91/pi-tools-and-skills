# T-886 consolidated reliability validation

Status: active
Date: 2026-09-05

## Scope and current disposition

Current candidate implements the crash-reliability portion of T-886 under accepted ADR-059. Prior `t-886-*` stage reports retain historical RED/PASS/REVISE evidence; they are not current release verdicts. Principal directed GM takeover after repeated partial worker reviews. The GM stopped the builder before editing and retained a different Luna for final independent review.

Implementation is not proof of the historical process-death mechanism. It fixes reproducible parser, duplicate-driver, stale-authority, replacement-context and watchdog defects. No live crash reproduction, provider calls, runtime enablement, model/default or scheduler changes were performed.

## Consolidated evidence

- Original baseline: four RED cases (continue misparse, initial synchronous send failure, duplicate drivers, steer failure); retained tests remain active.
- GM final-races suite: four independently executed RED cases before the relevant correction — stale-driver mutation of a successor, wrong-workspace replacement send, pending reservation surviving revoke, and observer watchdog adopting a persisted owner. All now GREEN.
- Empty run-directory cleanup: dedicated RED (`projection: failed` instead of complete) before replacing inappropriate directory `rm` with bounded `rmdir`. Unknown files remain preserved.
- Actual SDK session-manager fixture exercises shutdown of old extension, new binding setup, new extension hooks, fresh callback, and stale old-host access traps. Also covers wrong same-workspace session identity/binding, normal shutdown waiter settlement and unknown handoff outcome.
- Independent child processes load only a disposable test extension through the supported SDK loader, with isolated agent directory. Exactly one durable claim succeeds; even after winner exit, later claim conflicts until explicit revocation and a new run. No new dependency or live state involved.
- Ordinary fixtures now use the real revision transaction. Production `saveGoal` and unchecked `clearGoal` snapshot APIs are removed.
- `npm run check`: PASS, strict type coverage 99.24%; existing nonblocking lint warnings remain; knip clean.
- `npm test`: PASS before the final additional local-start regression, 215 files / 1594 tests. After that regression, a concurrent validation run hit an unrelated Teams cancellation fixture timing failure; its isolated rerun passed. `npm test -- --maxWorkers=2` then passed all 215 files / 1595 tests, without timeout increases or skipped tests. No unrelated source/test changes were made.
- Concurrent local starts: additional regression executed RED (waiter timeout) before a post-claim local-driver recheck; all six GM final-race tests now pass.
- Final primary goal LSP (23 files) and session lens error diagnostics (48 dispatched files) clean; `git diff --check` clean.
- Independent final Luna review PASS, including the exact local-start delta and docs/C4, retained at `t-886-final-independent-review.md`. Reviewer also records its default timeout failures and explicit-timeout full rerun rather than hiding them.
- Bounded redacted gitleaks candidate scan passed (49 files before retaining the final review report); final staged scan required before commit.

## Contract mapping

- Claim/admit/revoke/release and post-turn accounting use locked revision/owner checks. Terminal/operator stop clears owner/admission/reservation in the same authority commit.
- Only the command loop drives; lifecycle events settle only the matching local goal/token/session waiter. One local driver per process is a deliberate safe restriction.
- Driver scope captures plain binding data before replacement, not stale host objects. Setup records the expected new session id. Callback validates cwd/id/binding, consumes the exact reservation with admission and uses only the fresh context.
- Owner-local watchdogs never acquire persisted claims or dispatch for other processes. Active/queued guards and admission checks remain bounded; no delivery proof is inferred from void sends.
- Explicit stop/pause then run/resume is required for recovery. Malformed claims fail closed. Already admitted remote turns cannot be retracted or proved idle.
- Authority precedes projections; cleanup failure is distinguishable from mutation failure. Known-artifact cleanup preserves unknown files. Detected symlinks/nonregular authority fail closed; hostile filesystem check/use races remain a documented Node limitation.
- Source modules split along command mutation and filesystem responsibilities to satisfy existing architecture budgets; no test exemptions.

## Remaining combined-ticket scope (not silently delivered)

The upstream-informed augmentation brief remains a separate gated portion of T-886: opt-in light mode/promotion, compact lifecycle markers, tool exposure gating, and objective-writer skill. Proposed upstream tool names differ from current tools and require design reconciliation/council before public contract changes. Cache-cost work remains subject to Principal's later token-accounting deferral (T-828); this reliability patch does not add it. Native output budgets remain T-899.

Do not close the combined ticket from this reliability release alone. A separately approved split/disposition or delivery of remaining augmentation is required. Independent review and validation above cover reliability. Pushed-commit evidence and final scoped scan are recorded in canonical Kanban; neither closes the undelivered augmentation.
