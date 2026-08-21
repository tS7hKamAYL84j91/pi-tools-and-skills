# Pi Boost Extension

Bounded environmental and cognitive lease/yield capabilities for pi.

## Stable Commands and Tools

- `/boost` or `/boost settings` — inspect/edit effective Boost settings using standard Pi settings scopes.
- `/boost <prompt>` — request a bounded environmental lease; host runtime injection remains required.
- `/boost fusion <prompt>` — run one bounded multi-model cognitive lease and yield one synthesized result.
- `boost_fusion` — tool equivalent of cognitive Fusion for Principal or pre-granted agent sessions.

## Authorization and settings

Authorization is default-deny. Principal sessions remain authorized by the reviewed identity boundary. Agent self-boost is available only when operator-authored settings explicitly enable it under the namespaced `boost.agentSelfBoost` policy. Callers cannot enable, expand, or select that policy through command/tool arguments, objective text, or mutable agent names.

Settings resolve from `~/.pi/agent/settings.json`, followed by `.pi/settings.json` only when the Pi host marks the project trusted. The `/boost` SettingsList shows provenance and fixed profile, panel, model, judge, timeout, yield, and capability caps; writes target only the selected standard scope.

## Public and Internal Boundaries

The public surface is the extension entrypoint, `/boost`, `boost_fusion`, the reviewed host-construction contract, and redacted lease status/results. Files under `boost/` and runtime persistence/adaptation modules are internal.

Environmental Boost owns the persisted two-hour TTL, process-wide slot, bounded yields, durable state/audit, provider adaptation, baseline reversion, and shutdown recovery. Cognitive Boost owns a prompt-scoped panel/judge lease: bounded parallel panel calls, strict judge synthesis, one result yield, immediate release, and private redacted audit without prompts or model identities.

The declarative environmental `boost.md` remains discovered through the neutral shared discovery library. Live control is injected and read-only. Cognitive configuration uses standard Pi JSON settings; neither configuration surface may mint authority.

## What this does NOT do

- Does not run as a Team or import Panopticon/Teams private modules.
- Does not accept Team manifests or a bespoke `pi-boost/config.json`.
- Does not let callers, schedules, providers, or untrusted project settings mint or expand capabilities.
- Does not change root-model defaults or schedule cadence.
- Does not expose prompts, credentials, model identities, descriptor paths, or mutable control records through status/audit.
- Does not retain cognitive panel state after its single yield.
- Does not silently continue after environmental reversion or cognitive audit failure; execution fails closed.
