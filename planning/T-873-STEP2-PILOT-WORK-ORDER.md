# T-873 Step 2 Work-Order (DRAFT — pending chief-of-staff review, then explicit Principal authorization via Lumen)

- **Rollout step:** 2 of 3 — bounded pilot workspace, live daemon, real schedules (ADR-0018 rollback section: "one bounded pilot workspace... then broader adoption — each step a separate explicit authorization")
- **Status:** DRAFT. The Principal go/no-go happens only after chief-of-staff reviews this draft. **No live activation before that authorization.**
- **Drafted by:** pi-tools-and-skills-gm
- **Prerequisites met:** step 1 executed and accepted (7/7 steps PASS, zero deliveries, `8a9c3b4`); T-872 validation gates PASS (15/15 rows, TOCTOU fixed); T-870 registry seam (DaemonRegistry + sync protocol + panopticon client) landed.

## 1. Enabling changes (required before live)

| # | Change | Clause |
|---|---|---|
| E1 | **Registry-derived guard inputs in live delivery:** `main.ts` replaces the hardcoded guard-input constant with `registry.guardInputsFor(workspaceAgentId)`; `assertLiveModeAuthorized` flips to `registrySeamReady = true` only after this lands. | Design doc §5a; T-869 review B3 alternative |
| E2 | **Real policy decision at enqueue:** replace the `policyDecision: { allowed: true }` hardcode with `authorizeSend(loadedPolicy, …)`; bootstrap writes a signed default policy allowing the daemon sender → pilot-workspace recipients, type `schedule_delivery` only. | Queue contract (queue.ts "never caller-supplied"); ADR §6 |
| E3 | **Daemon-as-sender disposition:** the daemon sends as `a-coas-daemon` (infrastructure sender, not an agent). Recorded here and in the pilot report for council visibility against the ADR "no daemon-as-agent" non-action — the daemon routes, it does not run agent turns. | ADR Non-actions |
| E4 | **Pilot workspace selection:** one workspace, named by the Principal in the authorization (default proposal: a dedicated `pilot` workspace, not an EO production workspace). | ADR decision 8 |

## 2. Scope

- **Exactly one pilot workspace** (E4). Real schedule files in that workspace's CoAS home, consumed unchanged.
- Live daemon: `COAS_DAEMON_MODE=live` for the pilot workspace only; all other workspaces stay on the incumbent in-pi scheduler (mixed-mode matrix, fail-closed between modes).
- Deliveries flow through the authenticated envelope path: daemon tick → claim-check → signed envelope → durable queue → serve-loop lease → the pilot workspace's admitted root binding.
- coas-pi untouched: no deprecation, no removal, no Zellij changes (step 3, Q-coordinated).

## 3. Execution plan

| Step | Action | Expected |
|---|---|---|
| 1 | Land E1–E3 with tests; `registrySeamReady` flips only with the registry-derived inputs | Gates green; live mode authorized in code but not yet run |
| 2 | Principal authorization received via Lumen → start the daemon with `COAS_DAEMON_MODE=live` scoped to the pilot workspace | Audit `daemon_started` with posture + workspace tag |
| 3 | Observe ≥3 schedule cycles on real pilot schedules | Deliveries traverse the envelope path; claims rotate; M1 coalescing on any missed cycle |
| 4 | Mid-point review at ~24h: counters, dead-letter reasons, guard drops, pi-session reconnect after a deliberate pi restart | Sessions survive; schedules fire on reconnect; no double-writer (M5 lease holds) |
| 5 | Pilot report to chief-of-staff → Principal decision on step 3 | Bounded by the pilot window |

## 4. Bounded window and cadence

- Pilot window: **48 hours** from live activation, extendable once by 24h with chief-of-staff agreement.
- Schedule cadence in the pilot: existing pilot-workspace schedules only; the 5-minute daemon cap stays enforced.

## 5. Rollback / exit path (restated per ADR-0018)

- Stop the daemon and/or set `COAS_DAEMON_MODE=dry_run`; the pilot workspace reverts to the incumbent in-pi scheduler + Zellij model immediately.
- Durable state (identities, queue, schedule-state) retained read-only; in-flight signed messages dead-lettered `daemon_disabled` — replayable by a re-enabled daemon subject to `expires_at`.
- Exit path: the daemon owns no agent execution; exit does not strand agent state beyond the durable session directories.

## 6. Abort criteria (any one aborts the pilot immediately)

1. Any delivery to a non-pilot workspace or non-admitted binding.
2. Guard-drop storm (more than the documented guard behavior) or any delivery without a valid envelope path.
3. Daemon failure-threshold trips (≥3 crashes/24h or any state-corruption event — the breaker auto-disables and alerts).
4. Any state-corruption event detected by the strict reader.
5. Direction from the Principal, chief-of-staff, or Quartermaster.

## 7. Success criteria

- All pilot deliveries traverse the authenticated envelope + guard path (delivery-seam rule holds under live operation).
- A pi restart inside the pilot window: sessions reconnect, schedules continue, no loss of agent state (the failure this ADR exists to remove).
- Zero unexplained dead-letters; every dead-letter has a reason and audit record.
- M4 counters sane throughout (delivered/retried/parked/deadLettered/quarantined/deferred).
- Audit trail complete, posture-labelled, bounded.

## 8. Explicitly out of scope

- coas-pi deprecation (step 3, Q-coordinated, after bounded parallel-run).
- Broader adoption beyond the single pilot workspace.
- Any change to root-model defaults, residency, or non-pilot schedule cadence.

## 9. Authorization chain

1. Chief-of-staff reviews this draft → routes to the Principal via Lumen.
2. Principal go/no-go (explicit, via Lumen) → step 2 executes per this work-order.
3. Pilot report → Principal decision on step 3.