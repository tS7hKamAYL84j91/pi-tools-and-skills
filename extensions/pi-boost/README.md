# Pi Boost Extension

Principal-only, bounded temporary model-lease control for pi.

## Stable Command

- `/boost` — request, inspect, or reset a bounded Boost lease. Normal loading is fail-closed until the host injects the reviewed Q runtime capability.

## Public and Internal Boundaries

The public surface is the extension entrypoint, `/boost`, the reviewed host-construction contract, and redacted lease status. Files under `boost/` and runtime persistence/adaptation modules are internal implementation details.

`pi-boost` owns authorization, lease bounds, the process-wide slot, durable state and audit, Q runtime adaptation, baseline reversion, and shutdown recovery. It does not depend on Panopticon. The default extension grants identity only when `PI_PRINCIPAL=1` and no Panopticon parent-agent marker is present.

## What this does NOT do

- Does not run as a team or delegate Boost authority to team members.
- Does not let Panopticon, schedules, providers, or project configuration mint leases.
- Does not change root-model defaults or schedule cadence.
- Does not expose prompts, provider credentials, model identities, or mutable Q controls through status or audit output.
- Does not silently continue after failed reversion; dispatch fails closed.
