import { describe, expect, it } from "vitest";
import { omitEmptyTools } from "../extensions/pi-llm-council/provider-payload.js";

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
