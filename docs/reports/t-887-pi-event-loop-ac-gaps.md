# T-887 pi-event-loop — AC coverage gaps requiring P5+

Status: active
Date: 2026-09-04
**Scope:** docs/AC-coverage audit of the P1-P4 modules at `7da1b6b` on `t887/pi-event-loop-docs`.
**Full audit:** [`docs/pi-event-loop-c4.md`](../pi-event-loop-c4.md) (§6 table maps every AC-1..26 to test evidence; §4 records the isolation audit).

No implementation of the gaps below was done in this lane; each is owned by a P5+ module.

## Gaps requiring later phases

| AC | Gap | Owner (SPEC §20 / TODO phase) |
| --- | --- | --- |
| AC-12 (remainder) | `agent_settled` / lifecycle hook wiring so a command issued mid-turn actually waits for settlement before the next delivery | P5 — `session-state.ts` + Pi lifecycle hooks |
| AC-16 | Timer occurrence appends a deterministic event before any command | P5 — `timers.ts` |
| AC-17 | Timer catch-up appends at most one event per timer (interval: latest missed; daily: none) | P5 — `timers.ts` |
| AC-18 | Restart replays only events after the latest checkpoint (snapshot + tail replay) | P5 — `session-state.ts` |
| AC-19 (remainder) | Full projection rebuild when the config fingerprint changes | P5 — `session-state.ts` (fingerprint detection itself is covered, `config.ts`) |
| AC-20 (remainder) | Re-delivery of an uncertain active command with the same command ID on resume | P5 — `session-state.ts` (stable-ID determinism itself is covered) |
| AC-21 (remainder) | Enforce causal chain depth, consecutive automated-turn and per-view open-item limits; pause with operator-visible reason | P6 — loop protection |
| AC-22 (remainder) | `correctsEventId` retraction facts accepted as configured slices | P8 — correction/compensation |
| AC-11 (runtime half) | Live per-turn contract reporting via the read-only `event_loop_context` tool | P7 — operator controls |

## Pre-existing gate failure (not caused by this work, verified at HEAD)

`tests/shared/test-quality.test.ts` — "production modules must not survive on test-only
importers" — flags `extensions/pi-event-loop/dispatcher.ts` (importers are all test files).
This is expected mid-build: the production caller is the P5 lifecycle wiring in `index.ts`
(sibling lane). It fails identically at `7da1b6b` without the docs/AC work. Resolution is P5
wiring, not a fitness-test exception (exemptions are forbidden by repo policy).

## Validation recorded at audit time

- 84 P1-P4 tests green (`extensions/pi-event-loop/tests` + `tests/pi-event-loop-runtime.test.ts`).
- New: 5 AC-coverage tests (`tests/pi-event-loop-ac-coverage.test.ts`) + 4 isolation/layer guards
  (`tests/architecture/pi-event-loop-isolation.ts`, wired via `tests/architecture.test.ts`).
- `npm run check` passes; `npx vitest run` 1413/1414 (the 1 failure is the pre-existing finding above).

Fold this note into the GM integration checklist or close it when P5-P8 land; remove from
`docs/reports/` once the gaps are implemented (repo docs convention).