# T-828 — Cost-per-iteration tracking in pi-goal

## Goal

Make iteration cost (token usage + estimated dollar cost) and a simple
progress-per-dollar metric visible in pi-goal durable artifacts and UI.
Adopts the a16z loop-convergence recommendation that agents should track
cost-per-iteration to judge convergence and stop broadening scope.

## Background

The pi runtime already surfaces per-assistant-message usage:

```typescript
interface AssistantMessage {
  usage: {
    input: number;
    output: number;
    cost: { total: number; };
  };
}
```

pi-goal's `agent_end` handler receives the full message branch and writes each
iteration to `.pi/goal/runs/YYYY/MM/DD/<runId>-iter-NNN.{jsonl,md}`. It also
renders `STATUS.md`. Currently no cost data is captured.

## Approach

1. Extend `GoalState` with cumulative cost fields:
   - `iterationCosts: readonly IterationCost[]`
   - `totalCost: number`
   - `totalInputTokens: number`
   - `totalOutputTokens: number`

   ```typescript
   interface IterationCost {
     readonly iteration: number;
     readonly inputTokens: number;
     readonly outputTokens: number;
     readonly cost: number;
     readonly timestamp: string;
   }
   ```

2. In `goal-extension.ts` `agent_end` handler (both loop and standalone paths),
   find the last assistant message, extract usage, and append an
   `IterationCost` record to the state before saving.

3. In `goal-persist.ts` `writeGoalIteration`, pass the cost record and include it
   in the rendered markdown.

4. In `goal-render.ts` `renderStatusMarkdown`, add a cost section:
   - Total cost so far: `$<totalCost>`
   - Tokens: `↑<input> ↓<output>`
   - Progress per dollar: `<milestonesDone>/<totalMilestones> milestones / $<totalCost>`
     (or `turnsUsed/turnBudget turns / $<totalCost>` when no milestones)

5. Update `goal-parse.ts` to accept the new optional fields and retain backward
   compatibility with older `goal.json` files.

6. Add/adjust tests in `tests/goal/`:
   - `goal_parse.test.ts` or existing plan tests: parse state with cost fields.
   - New `goal-cost-tracking.test.ts`: simulate `agent_end` with assistant
     messages carrying usage and assert state + STATUS.md include cost data.

## Files to change

- `extensions/pi-goal/goal-types.ts` — add `IterationCost` and extend `GoalState`.
- `extensions/pi-goal/goal-extension.ts` — extract usage on `agent_end`.
- `extensions/pi-goal/goal-persist.ts` — pass cost to `writeGoalIteration` and render it.
- `extensions/pi-goal/goal-render.ts` — render cost in iteration and STATUS markdown.
- `extensions/pi-goal/goal-parse.ts` — parse new optional fields.
- `tests/goal/goal-cost-tracking.test.ts` — new test file.

## Acceptance gates

- [ ] `GoalState` carries cumulative cost/token totals and per-iteration cost records.
- [ ] `agent_end` extracts cost from the final assistant message when present.
- [ ] `STATUS.md` shows total cost, tokens, and progress-per-dollar.
- [ ] Iteration markdown files include the iteration's cost.
- [ ] Old `goal.json` files without cost fields still load correctly.
- [ ] `npm run check` clean.
- [ ] `npm test` passes, including new tests.

## Review plan

Navigator review for the approach; no ADR required (defensive observability,
no authority change).
