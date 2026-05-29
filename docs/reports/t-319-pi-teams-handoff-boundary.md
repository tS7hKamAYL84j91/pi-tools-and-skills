# T-319 pi-teams Handoff Boundary Hardening

Date: 2026-05-29
State: implementation slice

## Summary

T-319 separates the current internal handoff path into schema validation, target resolution, and runtime routing without adding a public CLI/API, durable schema, checkpoint/resume behavior, or provider/live-network integration.

Changed paths:

- `extensions/pi-teams/handoff.ts` — internal handoff schema, explicit node-target allow-list resolution, runtime-routable target guard, circular-route detection, and batch routing with partial-failure reporting.
- `extensions/pi-teams/team-handlers.ts` — debate/research handoff detail emission now routes through the hardened handoff boundary.
- `tests/team-handoff.test.ts` — deterministic malformed/unknown/circular/failed-resolution/partial-failure/valid-path coverage.
- `tests/team-research-stop.test.ts` — regression coverage that research records only routable handoff details.

## Boundary

Allowed handoff target type for this slice:

- `node` — a bounded internal protocol node id such as `synthesis` or `explorer_2`.

Rejected now:

- free-form string targets;
- broad target types such as `agent`, `model`, path-like ids, or arbitrary objects;
- unknown node ids not present in the protocol-local allow-list;
- targets that cannot resolve to both a binding and model for runtime routing;
- direct or multi-edge circular handoffs within a run.

## Compatibility notes

Valid existing handoff details remain compatible:

- debate still records the handoff to `synthesis` with the same message/data shape;
- research still records verifier-to-next-explorer handoffs with the same message/data shape when another explorer pass will actually run.

The previous terminal research-loop detail that pointed to a non-existent next explorer is no longer emitted. This is intentional: it was not runtime-routable and now falls outside the allowed target-resolution boundary.

## ADR disposition

No new ADR is required. This slice keeps the handoff schema internal to pi-teams runtime/detail emission, does not bump persisted event versions, and does not promote `run_detail` to a public/durable contract. ADR 018 remains the controlling state/detail boundary.
