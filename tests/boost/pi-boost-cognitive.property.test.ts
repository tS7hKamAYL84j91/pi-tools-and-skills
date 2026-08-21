import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planCognitiveFusion } from "../../extensions/pi-boost/boost/cognitive-planner.js";
import { truncateAtSemanticBoundary } from "../../extensions/pi-boost/boost/cognitive-output.js";
import { assertProperty } from "../lib/fast-check.js";

const model = fc.tuple(
	fc.constantFrom("a", "b", "c"),
	fc.array(fc.constantFrom("x", "y", "0", "-"), { minLength: 1, maxLength: 8 }).map((parts) => parts.join("")),
).map(([provider, id]) => `${provider}/${id}`);

describe("bounded cognitive Boost properties", () => {
	it("keeps planned panels visible, unique, and within the hard cap", () => {
		assertProperty(fc.property(
			fc.array(model, { minLength: 1, maxLength: 12 }),
			fc.integer({ min: 1, max: 20 }),
			(models, requested) => {
				const plan = planCognitiveFusion({
					configuredPanel: models,
					visibleModels: models,
					maxPanelModels: requested,
					requireApprovalAboveCalls: 5,
				});
				expect(plan.panel.length).toBeGreaterThan(0);
				expect(plan.panel.length).toBeLessThanOrEqual(4);
				expect(new Set(plan.panel).size).toBe(plan.panel.length);
				expect(plan.panel.every((item) => models.includes(item))).toBe(true);
				expect(plan.estimatedCalls).toBe(plan.panel.length + 1);
			},
		));
	});

	it("never exceeds requested semantic truncation bounds", () => {
		assertProperty(fc.property(fc.string({ maxLength: 2_000 }), fc.integer({ min: 0, max: 500 }), (text, bound) => {
			expect(truncateAtSemanticBoundary(text, bound).length).toBeLessThanOrEqual(bound);
		}));
	});
});
