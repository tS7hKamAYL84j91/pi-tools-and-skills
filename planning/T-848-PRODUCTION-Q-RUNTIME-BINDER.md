# T-848 Production Q Runtime Binder

## Target

Assemble the reviewed production host from injected, already-owned dependencies only: strict read-only Q source/adapter, durable WAL store, governance classifier, cancellation-aware provider seam, baseline restore, redacted audit, clock, and lease IDs.

## Boundaries

- The binder creates `DaemonBoostControlStore`, `HostInjectedLiveBoostRuntime`, and the T-846 reviewed host constructor from injected dependencies.
- Q source is restricted to `resolve(enablementId)` and `subscribe(listener)`; no write/configuration/raw-evidence path exists.
- Provider, baseline, governance, and audit are host-injected seams. The binder does not configure a provider, mutate a default, schedule work, or dispatch during construction.
- Live controls remain disabled until Q separately supplies an approved two-hour, one-slot, three-yield record after independent PASS.

## Construction API

`createProductionQBoostHost(input)` will validate reviewed host identity through T-846, build the T-847 Q adapter with Principal issuer/clock, open the injected CAS WAL store, construct `HostInjectedLiveBoostRuntime`, and inject it into T-846. The return exposes only reviewed identity/factory/shutdown.

## Acceptance tests

1. Disabled/expired/malformed Q source produces bounded denial before provider call or durable-store mutation.
2. Valid structural Q record constructs cold: no provider dispatch at construction; a controlled fixture supports one terminal/revocation rollback path with redacted audit only.
3. Cancel/revoke causes `AbortSignal`, baseline restoration, redacted audit, and release; no prompt/output/token/provider body appears in audit.
4. Source-level checks prove no Q-write/config/default/scheduler/provider construction seam.
5. Full checks, focused tests, independent review, and Q validation pass before Q copies a live control.
