import { describe, expect, it } from "vitest";
import {
	mergeGenerationParameters,
	omitEmptyTools,
} from "../extensions/pi-panopticon/teams/provider-payload.js";

describe("omitEmptyTools", () => {
	it("omits an empty top-level tools array from provider payloads", () => {
		expect(omitEmptyTools({ model: "qwen3.5", tools: [] })).toEqual({
			model: "qwen3.5",
		});
	});

	it("leaves non-empty tools arrays unchanged", () => {
		const payload = {
			model: "qwen3.5",
			tools: [{ type: "function", function: { name: "read" } }],
		};

		expect(omitEmptyTools(payload)).toBe(payload);
	});

	it("leaves payloads without tools unchanged", () => {
		const payload = { model: "qwen3.5" };

		expect(omitEmptyTools(payload)).toBe(payload);
	});
});

describe("mergeGenerationParameters", () => {
	it("places parameters under Cloud Code Assist generationConfig", () => {
		const payload = {
			project: "project-id",
			model: "gemini-2.5-flash",
			request: {
				contents: [],
				generationConfig: { maxOutputTokens: 4096 },
			},
		};

		expect(mergeGenerationParameters(payload, { temperature: 0.1 })).toEqual({
			project: "project-id",
			model: "gemini-2.5-flash",
			request: {
				contents: [],
				generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
			},
		});
	});

	it("places parameters under Google GenerateContent config", () => {
		const payload = {
			model: "gemini-2.5-flash",
			contents: [],
			config: { systemInstruction: "system" },
		};

		expect(mergeGenerationParameters(payload, { temperature: 0.1 })).toEqual({
			model: "gemini-2.5-flash",
			contents: [],
			config: { systemInstruction: "system", temperature: 0.1 },
		});
	});

	it("keeps root-level parameters for OpenAI-compatible payloads", () => {
		const payload = { model: "gpt-4.1", messages: [] };

		expect(mergeGenerationParameters(payload, { temperature: 0.1 })).toEqual({
			model: "gpt-4.1",
			messages: [],
			temperature: 0.1,
		});
	});

	it("filters temperature from GPT-5 OpenAI-compatible payloads", () => {
		const payload = { model: "gpt-5.4-mini", input: [] };

		expect(
			mergeGenerationParameters(payload, {
				maxTokens: 4096,
				temperature: 0.1,
			}),
		).toEqual({
			model: "gpt-5.4-mini",
			input: [],
			maxTokens: 4096,
		});
	});

	it("leaves unknown payload shapes unchanged", () => {
		const payload = { model: "custom", prompt: "hello" };

		expect(mergeGenerationParameters(payload, { temperature: 0.1 })).toBe(payload);
	});

	it("leaves payload unchanged when parameters are empty", () => {
		const payload = { model: "gpt-4.1", messages: [] };

		expect(mergeGenerationParameters(payload, {})).toBe(payload);
	});
});
