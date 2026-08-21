import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { modelForBinding } from "../../extensions/pi-teams/team-node-runner.js";
import type { TeamAgentBinding } from "../../extensions/pi-teams/team-types.js";
import { assertProperty } from "../lib/fast-check.js";

const modelArbitrary = fc.array(fc.constantFrom("a", "b", "0", "-"), { minLength: 1, maxLength: 12 })
	.map((parts) => parts.join(""));

function binding(subagent: string, model?: string): TeamAgentBinding {
	return { role: "member", subagent, ...(model === undefined ? {} : { model }) };
}

describe("bounded Teams contract properties", () => {
	it("prefers an explicit binding model and otherwise uses the fallback", () => {
		assertProperty(fc.property(modelArbitrary, modelArbitrary, (subagent, fallback) => {
			expect(modelForBinding(binding(subagent), fallback)).toBe(fallback);
			expect(modelForBinding(binding(subagent, "bound-model"), fallback)).toBe("bound-model");
		}));
	});
});
