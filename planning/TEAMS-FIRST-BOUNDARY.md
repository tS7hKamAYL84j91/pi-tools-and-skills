# Teams-First Extraction Boundary

## Ownership

`pi-teams` will own the current `teams/` module and `swarm/` compatibility adapter because swarm imports `TeamsFacade`, `TeamSpec`, and the Team registry directly. The module keeps its bounded static `TEAM_HANDLERS` list; the deferred SPI branch is not an input.

`pi-panopticon` will retain registry, peer messaging, agent spawning, health, UI, and reconciliation. It will no longer import or register Teams/Swarm.

## Explicit public/shared services

Teams continues to use existing shared `lib/` primitives for runtime entities, agent discovery/messaging, persistence, settings, tool results, and child-process handling. No Panopticon-private runtime state becomes public.

The only current private dependency is `teams/runner.ts` importing `resolvePiBinary()` from `pi-panopticon/spawner/spawn-service.ts`. Move that small resolver into `pi-teams`; retain the full spawner service in Panopticon.

## Migration shape

1. Move `extensions/pi-panopticon/teams/` and `extensions/pi-panopticon/swarm/` under `extensions/pi-teams/`.
2. Add `pi-teams/index.ts` to create its runtime plane, register Teams, and register swarm compatibility.
3. Add an independent `pi-teams/package.json`, including the current Teams skill path.
4. Remove Teams/Swarm imports, setup, and shutdown calls from Panopticon.
5. Rewrite test and architecture path references; preserve tool-name and runtime-entity behavior.
6. Update root setup allowlists/package documentation and C4 architecture.

## Deferred

`lib/team-protocol-spi.ts`, `TeamTopologyRegistry`, and all SPI-branch-only property/linter work remain isolated on `defer/team-protocol-spi`.
