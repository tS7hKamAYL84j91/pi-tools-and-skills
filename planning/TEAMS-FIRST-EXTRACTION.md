# Teams-First Extraction

## Objective
Extract the existing Teams module into `extensions/pi-teams` before considering a generic protocol SPI. Preserve existing Team tools and bounded direct protocol behavior.

## Constraints
- Leave `defer/team-protocol-spi` isolated; do not import `lib/team-protocol-spi.ts` or `TeamTopologyRegistry`.
- No generic DAG/workflow engine.
- Preserve `team_*`, `runtime_status`, and `runtime_stop` behavior.
- Panopticon may provide only documented runtime/agent services through a narrow public boundary; it must not retain Teams private state.
- No Boost, TTL, or unrelated property-suite work.

## Milestones
- [x] Map Panopticon-to-Teams imports and define the minimum public runtime boundary.
  - Validation command: `rg -n 'teams/' extensions/pi-panopticon tests`
  - Validation result: PASS (2026-08-21); Teams has no Panopticon-private import and owns its pi-binary resolver.
- [x] Move Teams into an independently installable `extensions/pi-teams` package and replace direct internal imports with the documented boundary.
  - Validation command: `npm run check && npm test`
  - Validation result: PASS (2026-08-21); check passed at 99.24% type coverage and 176 files / 1,381 tests passed.
- [x] Update C4 architecture and package/setup documentation; record ADR-048 if the public boundary changes.
  - Validation command: `git diff --check && npm run check && npm test`
  - Validation result: PASS (2026-08-21); ADR-048, Mermaid C4, setup wiring, and independent re-audit passed.

## Done when
`pi-teams` is independently packaged, Teams behavior remains validated, Panopticon has no private Teams import, and the SPI branch remains separate.
