# Pi Boost Extension

Principal-only, bounded temporary model-lease control for pi.

## Stable Command

- `/boost` — request, inspect, or reset a two-hour Boost lease. Normal loading is fail-closed until the host injects the reviewed provider runtime.

## Public and Internal Boundaries

The public surface is the extension entrypoint, `/boost`, the reviewed host-construction contract, and redacted lease status. Files under `boost/` and runtime persistence/adaptation modules are internal implementation details.

`pi-boost` owns authorization, the persisted two-hour TTL, one process-wide slot, the three-human-yield cap, durable state and audit, provider adaptation, baseline reversion, and shutdown recovery. Its declarative `boost.md` is discovered from built-in, user (`boost.roots` or `~/.pi/agent/boost`), then project (`.pi/boost`) roots through the neutral shared discovery library. The highest present layer must contain exactly one valid `boost.md`; malformed or ambiguous higher layers deny without fallback. Live control remains an injected read-only gate and cannot select a model. The default extension grants identity only when `PI_PRINCIPAL=1` and no Panopticon parent-agent marker is present.

## What this does NOT do

- Does not run as a Team or delegate Boost authority to Team members.
- Does not import Panopticon or accept Team manifests, protocol fields, or `pi-boost/config.json`.
- Does not let Panopticon, schedules, providers, or project configuration mint leases.
- Does not change root-model defaults or schedule cadence.
- Does not expose prompts, provider credentials, model identities, descriptor paths, or mutable live-control records through status or audit output.
- Does not silently continue after failed reversion; dispatch fails closed.
