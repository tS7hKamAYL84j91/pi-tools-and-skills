# pi-goal Session-Lineage Isolation

## Status

ADR-051 implemented in `feat/pi-goal-session-isolation`; root and independent audits passed before integration.

## Objective

Prevent concurrent pi sessions/agents in one cwd from reading or overwriting each other's pi-goal state.

## Milestones

- [x] Add private session binding and instance-scoped confined paths.
  - Validation: two-session binding/path unit tests PASS.
- [x] Route commands, tools, run loop, lifecycle hooks, watchdog, projections, and clear through the current binding.
  - Validation: focused pi-goal suite PASS (7 files / 55 tests).
- [x] Add lock-protected flat-layout migration and replacement-session inheritance.
  - Validation: migration, concurrency, continuation, clear, traversal, and symlink tests PASS.
- [x] Update README/Mermaid architecture and run review/full gates.
  - Validation: `npm run check` PASS (99.24%); `npm test` PASS (178 files / 1,407 tests); independent audit PASS (isolation 5/5, architecture 59/59).

## Constraints

- Session lineage, never mutable agent name, owns the binding.
- No caller-supplied goal selector.
- Preserve ADR-049 correlation, gates, manual/continuous behavior, and no-auto-completion.
- No Teams, Boost, CoAS, schedule, or T-850 changes.
