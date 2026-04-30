import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
	DEFAULT_CHAIRMAN_CANDIDATES,
	DEFAULT_MEMBER_CANDIDATES,
	resolveCouncilSettings,
} from "../extensions/pi-llm-council/settings.js";

function withTempSettings(settings: object, fn: (path: string) => void) {
	const dir = join(tmpdir(), `council-test-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "settings.json");
	try {
		writeFileSync(file, JSON.stringify(settings));
		fn(file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
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
