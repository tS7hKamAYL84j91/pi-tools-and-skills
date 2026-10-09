# Shared contracts and infrastructure

Keep extension orchestration beside its owner. Keep common persistence,
confinement, process and transport primitives here. Tests are not consumers,
and two files within one extension are not evidence of cross-extension reuse.
The inventory below records those distinctions instead of pretending every
module has multiple independent owners.

## Production consumer inventory

| Modules | Consumers / reason to keep central |
| --- | --- |
| `agent-api.ts`, `agent-registry.ts`, `agent-names.ts` | Agent lookup/identity shared by Team Workflows, Agent Hub, transports and Fleet; names also serve the shared agent API |
| `message-transport.ts`, `maildir.ts` (under `transports/`) | Matrix, Team Workflows, Agent Hub and Fleet transport contracts/adapters |
| `file-lock.ts`, `file-persistence.ts`, `pi-settings.ts`, `private-local-mode.ts` | Multiple extensions, Fleet applications and shared stores |
| `confined-store.ts`, `confined-store-security.ts`, `path-inside.ts` | Automations stores and shared path/config primitives; keep the security boundary central, not copied into consumers |
| `gate-command.ts`, `runtime-child-process.ts` | Goal/Kanban verification and Team Workflows child execution; preserve shared cancellation/output boundaries |
| `secret-redaction.ts` | Goal diagnostics and trusted-gate output |
| `tool-result.ts`, `tui-confirmation.ts`, `toggle-command.ts` | Multiple extension tool/UI surfaces |
| `automations-config.ts`, `automations-types.ts` | Automations and Agent Hub public configuration boundary |
| `automations-governance.ts` | Automations governance and its public type facade; policy/config primitive, not scheduler orchestration |
| `session-log.ts` | Agent Hub registry and UI consumers; generic Pi-session reader/redactor |
| `completion-signal.ts`, `task-brief.ts` | Agent Hub registry/spawner protocol contracts; pure data/parsing, no extension runtime state |

## Intentional single-consumer infrastructure

These remain central for a concrete infrastructure responsibility, not because
their tests create a second caller:

- `event-log.ts` — Kanban's transaction consumer delegates generic lock-held
  append behavior to this persistence primitive.
- `declarative-discovery.ts` — Team Workflows paths consume generic layered discovery;
  parsing and execution stay in Team Workflows.
- `tui-overflow.ts` — Team Workflows rendering uses pure bounded-scroll/count cues.

Team Workflows' `runtime-agent-messaging.ts` and `runtime-control-plane.ts` instead live
in `extensions/pi-team-workflows/`: their only production feature consumer is live-agent
role execution. Their adapter behavior is unchanged; `TeamStateManager` still
owns persisted runs. No compatibility facade or new state authority was added.

## Checks

`tests/architecture/lib-layering.ts` resolves local imports from production
extensions, libraries, scripts and both Fleet applications, excluding tests.
It checks this inventory, intentional single-consumer exceptions, pure core IO
restrictions and inward dependency direction. API/cycle and runtime safety
checks remain in the other architecture suites.
