import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
	DEFAULT_CHAIRMAN_CANDIDATES,
	DEFAULT_MEMBER_CANDIDATES,
	resolveCouncilSettings,
} from "../extensions/pi-llm-council/settings.js";

function withTempDir(fn: (dir: string) => void) {
	const dir = join(
		tmpdir(),
		`council-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	try {
		fn(dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function withTempSettings(settings: object, fn: (path: string) => void) {
	withTempDir((dir) => {
		const file = join(dir, "settings.json");
		writeFileSync(file, JSON.stringify(settings));
		fn(file);
	});
}

function writeTempExtensionConfig(dir: string): string {
	mkdirSync(join(dir, "prompts"));
	mkdirSync(join(dir, "subagents"));
	const configPath = join(dir, "config.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			promptDirectory: "prompts",
			subagentDirectory: "subagents",
		}),
	);
	return configPath;
}

describe("DEFAULT_MEMBER_CANDIDATES", () => {
	it("is the canonical visible-config list", () => {
		expect(DEFAULT_MEMBER_CANDIDATES).toEqual([
			"openai-codex/gpt-5.5",
			"google-gemini-cli/gemini-3.1-pro-preview",
			"ollama/qwen3.5:cloud",
			"ollama/glm-5.1:cloud",
		]);
	});
});

describe("DEFAULT_CHAIRMAN_CANDIDATES", () => {
	it("is the canonical visible-config list", () => {
		expect(DEFAULT_CHAIRMAN_CANDIDATES).toEqual([
			"openai-codex/gpt-5.5",
			"google-gemini-cli/gemini-3.1-pro-preview",
			"ollama/glm-5.1:cloud",
		]);
	});
});

describe("resolveCouncilSettings", () => {
	it("returns visible config defaults when no settings file exists", () => {
		const resolved = resolveCouncilSettings("/nonexistent/path/settings.json");
		expect(resolved.defaultMembers).toEqual(DEFAULT_MEMBER_CANDIDATES);
		expect(resolved.defaultChairman).toBe("openai-codex/gpt-5.5");
		expect(resolved.councils).toEqual({});
	});

	it("returns user overrides when settings file has them", () => {
		withTempSettings(
			{
				council: {
					defaultMembers: ["custom/model-1", "custom/model-2"],
					defaultChairman: "custom/chair",
				},
			},
			(file) => {
				const resolved = resolveCouncilSettings(file);
				expect(resolved.defaultMembers).toEqual([
					"custom/model-1",
					"custom/model-2",
				]);
				expect(resolved.defaultChairman).toBe("custom/chair");
			},
		);
	});

	it("fills in missing fields with visible config defaults (field-level merge)", () => {
		// User only set defaultMembers, not defaultChairman
		withTempSettings(
			{
				council: {
					defaultMembers: ["custom/model-1"],
				},
			},
			(file) => {
				const resolved = resolveCouncilSettings(file);
				expect(resolved.defaultMembers).toEqual(["custom/model-1"]);
				expect(resolved.defaultChairman).toBe("openai-codex/gpt-5.5");
			},
		);
	});

	it("loads default system prompts from subagent descriptors", () => {
		withTempDir((dir) => {
			const configPath = writeTempExtensionConfig(dir);
			writeFileSync(
				join(dir, "subagents", "navigator.md"),
				[
					"---",
					'name: "pair_navigator_consult"',
					'promptId: "pairNavigatorConsultSystem"',
					"---",
					"# IDENTITY",
					"",
					"Subagent navigator body.",
				].join("\n"),
			);

			const resolved = resolveCouncilSettings(
				"/nonexistent/path/settings.json",
				configPath,
			);
			expect(resolved.prompts.pairNavigatorConsultSystem).toEqual([
				"# IDENTITY",
				"",
				"Subagent navigator body.",
			]);
		});
	});

	it("keeps user prompt overrides ahead of subagent defaults", () => {
		withTempDir((dir) => {
			const configPath = writeTempExtensionConfig(dir);
			writeFileSync(
				join(dir, "subagents", "navigator.md"),
				[
					"---",
					'name: "pair_navigator_consult"',
					'promptId: "pairNavigatorConsultSystem"',
					"---",
					"Subagent default body.",
				].join("\n"),
			);
			withTempSettings(
				{
					council: {
						prompts: {
							pairNavigatorConsultSystem: ["User override body."],
						},
					},
				},
				(settingsPath) => {
					const resolved = resolveCouncilSettings(settingsPath, configPath);
					expect(resolved.prompts.pairNavigatorConsultSystem).toEqual([
						"User override body.",
					]);
				},
			);
		});
	});

	it("preserves named councils from user settings", () => {
		withTempSettings(
			{
				council: {
					councils: {
						architecture: {
							members: ["openai-codex/gpt-5.5"],
							chairman: "google-gemini-cli/gemini-3.1-pro-preview",
							purpose: "Architecture review",
						},
					},
				},
			},
			(file) => {
				const resolved = resolveCouncilSettings(file);
				expect(resolved.councils).toEqual({
					architecture: {
						members: ["openai-codex/gpt-5.5"],
						chairman: "google-gemini-cli/gemini-3.1-pro-preview",
						purpose: "Architecture review",
					},
				});
				// Defaults still come from visible extension config.
				expect(resolved.defaultMembers).toEqual(DEFAULT_MEMBER_CANDIDATES);
				expect(resolved.defaultChairman).toBe("openai-codex/gpt-5.5");
			},
		);
	});
});
