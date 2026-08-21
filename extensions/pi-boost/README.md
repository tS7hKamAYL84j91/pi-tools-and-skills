# Pi Boost Extension

Principal-only, bounded temporary model-lease control for pi.

## Stable Command

- `/boost` — request, inspect, or reset a two-hour Boost lease. Normal loading is fail-closed until the host injects the reviewed provider runtime.

## Public and Internal Boundaries

The public surface is the extension entrypoint, `/boost`, the reviewed host-construction contract, and redacted lease status. Files under `boost/` and runtime persistence/adaptation modules are internal implementation details.

`pi-boost` owns authorization, the persisted two-hour TTL, one process-wide slot, the three-human-yield cap, durable state and audit, provider adaptation, baseline reversion, and shutdown recovery. External Teams-shaped configuration is read-only input; its publisher has no Boost authority. The default extension grants identity only when `PI_PRINCIPAL=1` and no Panopticon parent-agent marker is present.

## What this does NOT do

- Does not run as a team or delegate Boost authority to team members.
- Does not let Panopticon, schedules, providers, or project configuration mint leases.
- Does not change root-model defaults or schedule cadence.
- Does not expose prompts, provider credentials, model identities, or mutable external-config controls through status or audit output.
- Does not silently continue after failed reversion; dispatch fails closed.
