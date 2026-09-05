import { describe, expect, it } from "vitest";
import { eligibleModelsFor } from "../../lib/coas-governance.js";

const privateInput = { classification: "private" as const, matchedTriggers: ["credential"], reason: "matched" };

describe("private model eligibility", () => {
	it("does not treat advisory candidates as evidence of locality", () => {
		const result = eligibleModelsFor(privateInput, ["cloud/remote", "ollama/advisory"]);
		expect(result.eligibleModels).toEqual([]);
		expect(result.escalate).toBe(true);
	});

	it("permits only explicitly local candidates for private input", () => {
		const result = eligibleModelsFor(privateInput, ["cloud/remote", "ollama/verified"], {
			localModelIds: ["ollama/verified"],
		});
		expect(result.eligibleModels).toEqual(["ollama/verified"]);
		expect(result.escalate).toBe(false);
	});

	it("escalates when a private child has no eligible local model", () => {
		const result = eligibleModelsFor(privateInput, ["cloud/remote"], {
			localModelIds: ["ollama/other"],
		});
		expect(result.eligibleModels).toEqual([]);
		expect(result.escalate).toBe(true);
	});
});
