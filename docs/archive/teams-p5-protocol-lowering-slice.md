# P5 Slice: Lower consult and telephone onto graph execution

## Goal

Move the simple built-in protocols (`consult`, `telephone`) off bespoke orchestration loops and onto the existing deterministic graph executor.

This is deliberately narrow. Debate still needs protocol-specific fanout/critique/synthesis semantics, and pair-coding still needs a bounded fix-loop primitive.

## Decisions

1. **Graph execution is the primitive; protocol lowering is small data shaping.**
   - `consult` lowers to a one-node graph.
   - `telephone` lowers to a linear graph where each relay depends on the prior relay.
2. **No live-agent compatibility in lowered consult.**
   - Graph nodes run one-shot model calls. `agent:` navigator refs are rejected clearly until a generic live-node runner exists.
3. **Prompt contracts stay protocol-slot based.**
   - `consult` adds a `node.template` slot with a pass-through default.
   - `telephone` keeps `relay.system` and `relay.template`; the lowerer renders those slots for graph node calls.
4. **State events stay protocol-abstract.**
   - Lowered protocols record one phase named by protocol and one node event per graph node through the existing state manager.

## Scope

- `extensions/pi-teams/team-handlers.ts`
- `extensions/pi-teams/team-graph.ts`
- `extensions/pi-teams/protocol-contracts.ts`
- `extensions/pi-teams/config/prompts/`
- tests for handler selection/lowering and graph prompt behavior
- `docs/archive/teams-future-improvements-progress-log.md`

## Non-goals

- No debate lowering in this slice.
- No pair-coding loop generalization in this slice.
- No generic live-agent graph runner in this slice.
- No new graph DSL.

## Acceptance criteria

- `consult` uses `runTeamGraph` through a protocol lowerer, not `consultModel` / `consultAgent` bespoke orchestration.
- `telephone` uses `runTeamGraph`, not a hand-written relay loop.
- `team-handlers.ts` no longer contains `pairConsultHandler` or `telephoneHandler` bespoke execution handlers.
- Tests prove `consult` and `telephone` handlers execute through graph-shaped node calls with deterministic outputs.
- `npm run check` and `npm test` pass.
