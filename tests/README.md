# Tests

Offline tests. No live providers, homeservers or model calls; opt-in live
experiments live in [`../benchmarks`](../benchmarks/README.md).

```sh
npm test                 # all tests
npx vitest run tests/<dir>   # one area
```

## Layout

- `agent-hub/`, `automations/`, `boost/`, `goal/`, `kanban/`, `matrix/`,
  `session/`, `team-workflows/`, `lib/` — behaviour for the matching source area.
- `architecture/` — fitness functions for dependencies, state ownership and
  documentation hygiene.
- `evals/` — offline evaluation contracts and benchmark fixtures.
- `runtime/`, `shared/` — cross-cutting runtime and registration checks.
- `fixtures/`, `helpers/` — shared test data and utilities.

Tests import production code directly; deep file paths are not public API.
