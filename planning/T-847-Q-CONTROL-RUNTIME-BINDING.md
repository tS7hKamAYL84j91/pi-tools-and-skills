# T-847 Q-Control Runtime Binding

## Target

Create only the strict read-only production `QBoostControlAdapter` binding. It adapts an injected Q record/revision source to the existing schema-v2 `QBoostControlAdapter`; it does not bind the bridge, WAL, budget, reversion, provider, baseline, or audit.

## Boundaries

- The source is injected and read-only: resolve by opaque enablement id and subscribe to revision events.
- The adapter performs no Q write, provider/config/default/scheduler mutation, or dispatch.
- Global slot, budget/WAL, bridge/revocation/restore, provider, baseline, and audit are separate host bindings.

## Binding validation

Before returning a record or subscribing, validate the canonical reference: team `q-boost`, both canonical logical keys, bounded opaque enablement id, and exact safe-integer non-negative mapping/rollback versions.

A returned record must be schema-v2 `boost`, match the reference and injected Principal issuer, have maximum yields 1–3, be enabled/verified/principal-owned/external-eligible, and be unexpired. Any missing, disabled, expired, mismatched, string/coerced, or stale input returns `undefined`/no subscription before provider use.

Revision subscriptions filter by enablement and strictly increasing safe-integer revision; `unsubscribe` is idempotent.

## Acceptance tests

1. Canonical valid record resolves unchanged; all disabled/expired/mismatch cases fail closed.
2. Invalid reference rejects before source resolve/subscribe.
3. Revision callback delivers only matching increasing revisions; stale/mismatched callbacks are dropped and unsubscribe is idempotent.
4. Source-level tests prove no provider/config/default/scheduler/Q-write seam and no raw signature/residency payload.
5. Full checks, focused tests, and independent review pass before Q handoff.
