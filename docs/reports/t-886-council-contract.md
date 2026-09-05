# T-886 Council Contract Recheck: Per-Goal Driver Ownership

Status: active

Date: 2026-09-05
Seat: manual council contract recheck
Reviewed: `docs/adr/059-goal-driver-ownership.md`
Disposition: **PASS — no concrete blocking divergence found**

This is a design verdict only. It authorizes no production or test edits. The prior candidate remains **REVISE** until implemented and verified. No Teams transport was rerun.

## Verdict

ADR-059 reconciles the material contract requirements and the prior report's concerns:

- ownership is persisted in authoritative goal state, not a separately committed sidecar;
- canonical identity is the confined goal instance path (`resolved project root + validated goalId`), with ADR-051 session binding as authorization;
- opaque token plus monotonically changing generation and revision discipline guard claims, sends, state transitions, tools, and post-`await` writes;
- send admission is recorded under the transaction before host delivery, while cancellation after admission is explicitly non-retractable;
- replacement sessions reserve handoff before `newSession`, install binding before delivery, and preserve logical ownership;
- watchdog activity is owner-associated only and records attempted, not proven, delivery;
- dead-owner takeover is not automatic. Explicit authorized pause/stop (or clear), followed by explicit run/resume, is the recovery path;
- the design does not claim exactly-once dispatch or global host quiescence.

These choices are compatible with ADR-049 bounded liveness, ADR-051 lineage isolation, the existing short advisory-lock boundary, and the installed pi host API.

## Host and primitive checks

The source/SDK boundary remains decisive:

- `ExtensionAPI.sendUserMessage` is typed `void` (`dist/core/extensions/types.d.ts:980`); the loader delegates without returning the host promise (`dist/core/extensions/loader.js:300-303`), and the host reports asynchronous rejection internally (`dist/core/agent-session.js:2013-2021`). Admission therefore means an authorized send attempt, not confirmed delivery.
- Replacement-session `sendUserMessage` is `Promise<void>` (`types.d.ts:297-305` and installed extension docs), so it remains awaited; rejection must not be interpreted as proof that no host work occurred.
- `lib/file-lock.ts` supplies short lock-protected filesystem transactions and token-conditional release. Its retry limit is not a lease or dead-owner detector. ADR-059 correctly removes any requirement for PID-start machinery in this slice.
- Existing `goal-persist.ts` load/write calls are separated by provider awaits. ADR-059's required reread plus token/generation/revision validation, including existing mutating tools, addresses the stale read/modify/write gap rather than relying on atomic JSON writes alone.

## Contract accepted for implementation design

1. **Canonical key:** confined authoritative instance path, equivalently resolved project root plus validated `goalId`; never display name, model, objective, session filename, or run ID alone.
2. **Live-owner denial:** a competing claim for the same key is denied while the persisted owner/generation remains valid. The owner token is opaque and associated with process/session lineage and logical generation; in-memory runtime state is not authority.
3. **Authoritative atomic discipline:** claim, revoke, release, send admission, tool mutation, and post-turn transitions are lock-protected read/check/write transactions. Each rereads current state and validates expected token, generation, and revision. Mismatch is a bounded stop/no-op, never a stale overwrite. Derived projections cannot overwrite newer authority.
4. **Admission boundary:** cancellation before admission prevents the host call; cancellation after admission invalidates future work but cannot retract the admitted call. No exactly-once or delivery acknowledgement is promised.
5. **Cancellation:** authorized pause/stop/edit/clear, terminal outcomes, and bounded timeout invalidate the relevant generation before waiter/marker settlement. Finalizers are exact-token/generation conditional. Local waiters settle even if persistence fails, with fail-closed bounded reporting and no false recovery claim.
6. **Replacement:** a replacement reservation is created while the old owner is valid; binding is installed before the awaited send; old shutdown/finalizers cannot release the reserved successor. Cancelled, failed, or unknown handoffs become interruption/recovery-needed, not uncoordinated retries.
7. **Watchdog:** only the current owner may warn/nudge/recover. A nudge requires current owner, idle host, no queued continuation, and revalidated admission immediately before the void call. It records an attempt, not delivery. No watchdog may acquire ownership at idle or timeout.
8. **Recovery:** no automatic dead-owner takeover, age steal, TTL, daemon, lease service, or PID-start machinery. An existing claim blocks new drivers regardless of age or PID metadata. Explicit authorized pause/stop (or clear), then explicit run/resume after the operator checks host state, is the supported recovery. Malformed/unverifiable ownership fails closed with guidance.

## Concrete blocking-divergence check

**None found.** ADR-059 makes the previously open choices explicit and does not weaken the exclusion contract.

The only operational residuals are deliberately accepted design limits, not blockers:

- a void send can be admitted but later fail or remain unobservable;
- explicit recovery cannot prove a remote/old host is idle and cannot retract an already-admitted turn;
- malformed or unverifiable ownership requires operator repair rather than automatic takeover.

These are stated in ADR-059 and are consistent with the host boundary and the requested no-automatic-recovery policy.

## Required implementation evidence

Before implementation approval is converted into a production merge, tests must demonstrate:

- concurrent same-key claims admit one driver and deny the other;
- pre-admission cancellation prevents sending, while post-admission cancellation prevents subsequent admissions and stale writes;
- stale token/generation/revision writes, releases, tool mutations, and late callbacks cannot overwrite successors;
- replacement reservation, binding-before-send, cancellation, shutdown, and rejection preserve exclusion;
- owner-only watchdog behavior produces no second driver and never reports void-send delivery as proven;
- explicit pause/stop then run/resume is the only recovery path, with no age-based takeover;
- persistence/UI failure during containment remains fail-closed and does not falsely report recovery;
- existing ADR-049/051/055 behavior, parser and binding tests, focused duplicate-driver regression, `npm run check`, and `npm test` remain green.

## Council conclusion

**PASS ADR-059 as the reconciled design contract.** Do not implement beyond this approved shape, and do not treat this PASS as evidence that the current candidate is fixed. Await the other seat's reconciliation and subsequent implementation review.
