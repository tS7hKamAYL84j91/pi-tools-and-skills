import { describe, expect, it } from "vitest";

import {
	COUNCIL_MAX,
	COUNCIL_MIN,
	checkHeterogeneity,
	chooseChairmanModel,
	chooseCouncilModels,
	providerOf,
} from "../extensions/council/members.js";

describe("providerOf", () => {
	it("returns the prefix before the first slash", () => {
		expect(providerOf("anthropic/claude-opus-4-6")).toBe("anthropic");
		expect(providerOf("openai/gpt-5.5")).toBe("openai");
	});

	it("handles ollama-style colons in the model id", () => {
		expect(providerOf("ollama/qwen3.5:cloud")).toBe("ollama");
	});

	it("returns 'unknown' when there is no provider prefix", () => {
		expect(providerOf("standalone-model")).toBe("unknown");
	});
});

describe("checkHeterogeneity", () => {
	it("passes when ≥2 distinct providers are present", () => {
		const result = checkHeterogeneity([
			"openai/gpt-5.5",
			"anthropic/claude-opus-4-6",
			"google/gemini-2.5-pro",
		]);
		expect(result.ok).toBe(true);
		expect(result.providers.sort()).toEqual(["anthropic", "google", "openai"]);
	});

	it("fails when all members share a provider", () => {
		const result = checkHeterogeneity(["openai/gpt-5.5", "openai/gpt-5"]);
		expect(result.ok).toBe(false);
		expect(result.providers).toEqual(["openai"]);
		expect(result.reason).toMatch(/distinct providers/);
	});

	it("reports providers seen even when failing", () => {
		const result = checkHeterogeneity(["openai/a", "openai/b"]);
		expect(result.reason).toContain("openai");
	});

	it("fails on an empty council", () => {
		const result = checkHeterogeneity([]);
		expect(result.ok).toBe(false);
		expect(result.providers).toEqual([]);
	});
});

describe("chooseCouncilModels", () => {
	const snapshot = [
		"anthropic/claude-opus-4-6",
		"google/gemini-2.5-pro",
		"ollama/glm-5.1:cloud",
		"ollama/qwen3.5:cloud",
		"openai/gpt-5.5",
	];

	it("returns the explicit request unchanged (capped at COUNCIL_MAX)", () => {
		const requested = ["a/m1", "b/m2", "c/m3", "d/m4", "e/m5", "f/m6", "g/m7"];
		const chosen = chooseCouncilModels(snapshot, requested);
		expect(chosen).toEqual(requested.slice(0, COUNCIL_MAX));
	});

	it("dedupes and trims explicit requests", () => {
		const chosen = chooseCouncilModels(snapshot, [
			"  a/m1  ",
			"a/m1",
			"",
			"b/m2",
		]);
		expect(chosen).toEqual(["a/m1", "b/m2"]);
	});

	it("falls back to defaults filtered by snapshot when no request and no settings", () => {
		const chosen = chooseCouncilModels(snapshot);
		expect(chosen.length).toBeGreaterThanOrEqual(COUNCIL_MIN);
		expect(chosen.length).toBeLessThanOrEqual(COUNCIL_MAX);
		for (const model of chosen) expect(snapshot).toContain(model);
	});

	it("returns the static default candidate list when the snapshot is empty", () => {
		const chosen = chooseCouncilModels([]);
		expect(chosen.length).toBeGreaterThanOrEqual(COUNCIL_MIN);
	});
});

describe("chooseChairmanModel", () => {
	const snapshot = [
		"anthropic/claude-opus-4-6",
		"google/gemini-2.5-pro",
		"openai/gpt-5.5",
	];

	it("honors an explicit request", () => {
		expect(chooseChairmanModel(snapshot, ["a/m1"], "custom/chairman")).toBe(
			"custom/chairman",
		);
	});

	it("picks a default chairman candidate when one is in the snapshot", () => {
		const chairman = chooseChairmanModel(snapshot, ["openai/gpt-5.5"]);
		expect(snapshot).toContain(chairman);
	});

	it("falls back to the first member when no candidate is available", () => {
		const chairman = chooseChairmanModel([], ["only/member"]);
		expect(chairman).toBe("only/member");
	});
});
