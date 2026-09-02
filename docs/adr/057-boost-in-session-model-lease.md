# ADR-057: Boost is an in-session model lease that automates the manual model flip

## Status

Accepted — Principal direction, 2026-09-02. Supersedes ADR-052's "does not switch the session model" clause for `/boost <prompt>`; refines ADR-045/046 with explicit, bounded relaxations.

## Context

The Principal uses boost to automate a manual workflow: switch the session to a stronger model, run a stuck prompt with anti-rut framing, then switch back by hand. Commit `7ce2e1e` implemented exactly that flip but also deleted the ADR-045/046 authority, governance, audit, WAL/recovery, and global-slot machinery, and introduced correctness bugs (restore on `agent_end` before retries, silent restore failure, fire-and-forget settings writes, `maxYields` up to 10). Council review confirmed the rewrite violates five unsuperseded ADRs as written and requires an explicit superseding decision.

The Principal has decided the session-model flip is the product. The question is which guarantees are retained, which are explicitly relaxed, and which bugs are fixed regardless.

## Decision

`/boost` keeps switching the session model via `pi.setModel()` and restores the baseline when the run settles.

```mermaid
sequenceDiagram
  participant U as Principal
  participant B as /boost
  participant M as Session model
  U->>B: /boost <prompt>
  B->>B: check lease (blocked? exhausted? no model?)
  B->>M: setModel(boost) — persisted, like the manual flip
  B->>M: sendUserMessage(anti-rut frame + prompt)
  M-->>U: boost turn (retries/follow-ups stay on boost)
  B->>M: on agent_settled: restore captured baseline
  alt restore fails
    B->>B: enter blocked state; powerline shows blocked; /boost reset retries restore only
  end
```

### Retained invariants (correctness, not relaxable)

1. **Restore on `agent_settled`, not `agent_end`** — retries, compaction, and queued follow-ups run on the boost model; restoration happens only when the run is truly settled.
2. **RevertFailed blocking** — if baseline restoration fails, boost enters a visible blocked state (powerline + notification), refuses further dispatch, and only `/boost reset` retries restoration (never replays the prompt).
3. **Failed dispatch consumes no yield and restores immediately** — a `sendUserMessage` failure refunds the yield, attempts baseline restore, and surfaces the error.
4. **Streaming dispatch** — when the agent is not idle, the prompt is delivered with `deliverAs: "followUp"` instead of throwing.
5. **Yield cap is hard-bounded at 3** (`resolveMaxYields` clamps to 1..3, ADR-045 §1); the overlay offers 1/2/3 only.
6. **Settings writes are serialized** through a single write queue (read-modify-write races between overlay callbacks are eliminated).
7. **Registry is the canonical model source** (ADR-056): no provider IDs in production code; auto mode = first text-capable registry model different from the current model.
8. **Lease TTL is 10 minutes** (T-854, Principal direction 2026-09-02): a lease expires 600,000 ms after its first successful yield (down from the pre-KISS contract's 7,200,000 ms). Expired leases deny new dispatch fail-closed until `/boost reset` starts a new lease; an in-flight turn still completes and restores the baseline via the normal settle path. Reset clears expiry.

### UX contract

- Powerline status (`setStatus("boost", …)`) shows **only** lease state and remaining yields — never the prompt, model output, or model names: `Boost off · 3 left`, `Boost active · 2 left`, `Boost blocked · restore failed`.
- Model selection uses a **native-style searchable picker** (type-to-filter, ↑/↓, Enter saves, Esc cancels, current selection marked, baseline marked) — not a value carousel.
- `/boost clear` clears the configured model (back to auto); it is no longer a no-op.

### Explicit relaxations vs ADR-045/046 (accepted risk)

- No `BoostLeaseAuthority`, daemon, WAL, Q-config adapter, redacted audit sink, governance classification, or process-wide global slot. `/boost` is a per-session lease: any session in this checkout may run it, the budget is in-memory, and a restart resets it. This matches the manual workflow it replaces, which has the same properties.
- Compensating controls: hard yield cap of 3, visible lease state, RevertFailed blocking, restore-only reset, and bounded single-model dispatch.

## Consequences

- `/boost` honestly automates the Principal's manual flow, including `pi.setModel()`'s persistence of the boost model into session/settings while leased.
- A crashed or killed session can leave the boost model selected — identical to the manual workflow being automated; the next session's model picker resolves it.
- The deleted authority/audit machinery is consciously not re-imported; re-adding it would require a new ADR.

## Validation

- Boost tests invoke the production extension (fake `ExtensionAPI`/`ExtensionContext`), covering: auto-pick, framed prompt, restore on settle, revert-blocked + reset-retry, no-auth denial, exhaustion, reset, follow-up delivery, settings clamping, and lease expiry (TTL denial + reset recovery + in-flight restore).
- `npm run check` and `npm test` pass.
