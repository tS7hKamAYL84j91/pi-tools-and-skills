import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { parseGoalState } from "../../extensions/pi-goal/goal-parse.js";
import { assertProperty } from "../lib/fast-check.js";

const textArbitrary = fc.string({ unit: "grapheme", minLength: 1, maxLength: 24 });
const statusArbitrary = fc.constantFrom("active", "paused", "complete", "planning");

describe("bounded goal state properties", () => {
	it("round-trips valid data-only state through JSON without changing canonical fields", () => {
		assertProperty(fc.property(
			textArbitrary,
			textArbitrary,
			statusArbitrary,
			fc.integer({ min: 0, max: 100 }),
			fc.integer({ min: 0, max: 100 }),
			(schemaText, objective, status, turnBudget, turnsUsed) => {
				const raw = {
					schemaVersion: Number(schemaText.length % 3) + 1,
					goalId: `goal-${schemaText}`,
					objective,
					status,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-02T00:00:00.000Z",
					runActive: false,
					turnBudget,
					turnsUsed: Math.min(turnsUsed, turnBudget),
					milestones: [],
				};
				const parsed = parseGoalState(raw);
				expect(parseGoalState(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
				expect(parsed.goalId).toBe(raw.goalId);
				expect(parsed.objective).toBe(objective);
				expect(parsed.status).toBe(status);
			},
		));
	});
});
