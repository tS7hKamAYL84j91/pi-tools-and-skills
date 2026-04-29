import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
	COUNCIL_MAX,
	COUNCIL_MIN,
	checkHeterogeneity,
	chooseChairmanModel,
	chooseCouncilModels,
	providerOf,
} from "../extensions/pi-llm-council/members.js";

function withSettings<T>(council: object, fn: (settingsPath: string) => T): T {
	const dir = join(tmpdir(), `council-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "settings.json");
	try {
		writeFileSync(file, JSON.stringify({ council }));
		return fn(file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const NO_SETTINGS = "/nonexistent/path/settings.json";

// ── providerOf ──────────────────────────────────────────────────

describe("providerOf", () => {
	it("returns the prefix before the first slash", () => {
		expect(providerOf("anthropic/claude-opus-4-6")).toBe("anthropic");
		expect(providerOf("openai-codex/gpt-5.5")).toBe("openai-codex");
	});

	it("handles ollama-style colons in the model id", () => {
		expect(providerOf("ollama/qwen3.5:cloud")).toBe("ollama");
	});

	it("returns 'unknown' when there is no provider prefix", () => {
		expect(providerOf("standalone-model")).toBe("unknown");
	});
});

// ── checkHeterogeneity ──────────────────────────────────────────

describe("checkHeterogeneity", () => {
	it("passes when ≥2 distinct providers are present", () => {
		const result = checkHeterogeneity([
			"openai-codex/gpt-5.5",
			"google-gemini-cli/gemini-3.1-pro-preview",
			"ollama/qwen3.5:cloud",
		]);
		expect(result.ok).toBe(true);
		expect(result.providers.sort()).toEqual(["google-gemini-cli", "ollama", "openai-codex"]);
	});

	it("fails when all members share a provider", () => {
		const result = checkHeterogeneity(["openai-codex/gpt-5.5", "openai-codex/gpt-5"]);
		expect(result.ok).toBe(false);
		expect(result.providers).toEqual(["openai-codex"]);
		expect(result.reason).toMatch(/distinct providers/);
	});

	it("reports providers seen even when failing", () => {
		const result = checkHeterogeneity(["openai-codex/a", "openai-codex/b"]);
		expect(result.reason).toContain("openai-codex");
	});

	it("fails on an empty council", () => {
		const result = checkHeterogeneity([]);
		expect(result.ok).toBe(false);
		expect(result.providers).toEqual([]);
	});
});

// ── chooseCouncilModels ─────────────────────────────────────────

describe("chooseCouncilModels", () => {
	const snapshot = [
		"google-gemini-cli/gemini-3.1-pro-preview",
		"ollama/glm-5.1:cloud",
		"ollama/qwen3.5:cloud",
		"openai-codex/gpt-5.5",
	];

	it("returns the explicit request unchanged (capped at COUNCIL_MAX)", () => {
		const requested = ["a/m1", "b/m2", "c/m3", "d/m4", "e/m5", "f/m6", "g/m7"];
		const chosen = chooseCouncilModels(snapshot, requested, NO_SETTINGS);
		expect(chosen).toEqual(requested.slice(0, COUNCIL_MAX));
	});

	it("dedupes and trims explicit requests", () => {
		const chosen = chooseCouncilModels(snapshot, [
			"  a/m1  ",
			"a/m1",
			"",
			"b/m2",
		], NO_SETTINGS);
		expect(chosen).toEqual(["a/m1", "b/m2"]);
	});

	it("uses visible extension defaults filtered by snapshot when no settings file exists", () => {
		const chosen = chooseCouncilModels(snapshot, undefined, NO_SETTINGS);
		expect(chosen.length).toBeGreaterThanOrEqual(COUNCIL_MIN);
		expect(chosen.length).toBeLessThanOrEqual(COUNCIL_MAX);
		for (const model of chosen) expect(snapshot).toContain(model);
	});

	it("uses user-provided defaultMembers from settings", () => {
		withSettings(
			{ defaultMembers: ["a/m1", "b/m2", "c/m3"] },
			(settingsPath) => {
				// Snapshot doesn't need to contain the custom models because
				// when available.size > 0, resolved defaults are matched against it.
				// Use an empty snapshot to get the raw defaults (no filtering).
				const chosen = chooseCouncilModels([], undefined, settingsPath);
				expect(chosen).toEqual(["a/m1", "b/m2", "c/m3"].slice(0, COUNCIL_MIN));
			},
		);
	});

	it("returns default candidates when the snapshot is empty", () => {
		const chosen = chooseCouncilModels([], undefined, NO_SETTINGS);
		expect(chosen.length).toBeGreaterThanOrEqual(COUNCIL_MIN);
	});

	it("pads from snapshot when too few defaults match", () => {
		// Custom settings with only 1 model, but snapshot has extras
		withSettings(
			{ defaultMembers: ["a/m1"] },
			(settingsPath) => {
				const chosen = chooseCouncilModels(
					["a/m1", "b/m2", "c/m3"],
					undefined,
					settingsPath,
				);
				expect(chosen).toContain("a/m1");
				expect(chosen.length).toBeGreaterThanOrEqual(COUNCIL_MIN);
			},
		);
	});
});

// ── chooseChairmanModel ──────────────────────────────────────────

describe("chooseChairmanModel", () => {
	const snapshot = [
		"google-gemini-cli/gemini-3.1-pro-preview",
		"openai-codex/gpt-5.5",
	];

	it("honors an explicit request", () => {
		expect(
			chooseChairmanModel(snapshot, ["a/m1"], "custom/chairman", NO_SETTINGS),
		).toBe("custom/chairman");
	});

	it("picks resolved default chairman when it is in the registry", () => {
		withSettings(
			{ defaultChairman: "openai-codex/gpt-5.5" },
			(settingsPath) => {
				const chairman = chooseChairmanModel(
					snapshot,
					["openai-codex/gpt-5.5"],
					undefined,
					settingsPath,
				);
				expect(chairman).toBe("openai-codex/gpt-5.5");
			},
		);
	});

	it("falls back to chairman candidates when resolved default is not in registry", () => {
		// User's default chairman isn't in the snapshot at all
		withSettings(
			{ defaultChairman: "proprietary/ultra-model" },
			(settingsPath) => {
				const chairman = chooseChairmanModel(
					snapshot,
					["google-gemini-cli/gemini-3.1-pro-preview"],
					undefined,
					settingsPath,
				);
				// Should fall through to DEFAULT_CHAIRMAN_CANDIDATES matching snapshot
				expect(snapshot).toContain(chairman);
			},
		);
	});

	it("uses resolved default when registry is empty (can't validate)", () => {
		withSettings(
			{ defaultChairman: "proprietary/ultra-model" },
			(settingsPath) => {
				const chairman = chooseChairmanModel(
					[],
					["only/member"],
					undefined,
					settingsPath,
				);
				// Empty snapshot → can't validate → use resolved default
				expect(chairman).toBe("proprietary/ultra-model");
			},
		);
	});

	it("falls back to members[0] when no candidate and no default match", () => {
		const chairman = chooseChairmanModel(
			["unknown/host"],
			["only/member"],
			undefined,
			NO_SETTINGS,
		);
		// No settings/config default in registry, no chairman candidates match
		expect(chairman).toBe("only/member");
	});
});