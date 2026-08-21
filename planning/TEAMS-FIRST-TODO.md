# TODO: Extract pi-teams Before Protocol SPI

## Objective
Extract Teams and swarm compatibility from `pi-panopticon` into an independently installable `extensions/pi-teams` package. Defer the generic protocol SPI.

## Tasks
- [x] Map direct Panopticon/Teams imports and preserve only explicit public runtime services.
- [x] Move `teams/` and `swarm/` into `extensions/pi-teams/` with its own entrypoint and package manifest.
- [x] Keep the direct bounded `TEAM_HANDLERS` registry; do not add `TeamTopologyRegistry` or `lib/team-protocol-spi.ts`.
- [x] Make pi-binary resolution Teams-owned; keep Panopticon spawner private.
- [x] Remove Panopticon-owned Teams/swarm registration and update installation/setup wiring.
- [x] Preserve `team_*`, `runtime_status`, `runtime_stop`, and swarm compatibility behavior.
- [x] Update Mermaid C4 architecture, package documentation, and ADR-048 for the public extension boundary.
- [x] Run `npm run check` and `npm test`; independent architecture review passed before integration.

## Evidence

- `npm run check`: PASS, 99.24% type coverage.
- `npm test`: PASS, 176 files / 1,384 tests.
- Focused architecture/registration: PASS, 64 tests.
- Setup wiring: PASS, 7 tests.
- Gitleaks history and bounded working-tree scans: no leaks; the Make target's second phase is incompatible with the installed legacy CLI, so the equivalent `detect --no-git` command was used.
- Independent read-only architecture re-audit: DONE, no blockers.
