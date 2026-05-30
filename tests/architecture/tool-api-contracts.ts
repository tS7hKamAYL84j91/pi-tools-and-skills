/** Model-visible tool API contract fitness functions. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

function toolRuntimeFiles(): string[] {
	return listTsFiles("extensions").filter((file) => readFileSync(file, "utf8").includes("registerTool"));
}

describe("tool API contracts", () => {
	it("registered tools use the shared tool-result helper instead of ad hoc text envelopes", () => {
		const violations: string[] = [];
		for (const file of toolRuntimeFiles()) {
			const content = readFileSync(file, "utf8");
			if (content.includes("content: [{ type: \"text\"") || content.includes("content: [{ type: \"text\" as const")) {
				violations.push(relative(process.cwd(), file));
			}
		}
		expect(violations).toEqual([]);
	});

	it("tool failures use shared fail helper or thrown errors, not ad hoc isError envelopes", () => {
		const violations: string[] = [];
		for (const file of toolRuntimeFiles()) {
			const content = readFileSync(file, "utf8");
			if (content.includes("isError: true") && !content.includes("fail(")) {
				violations.push(relative(process.cwd(), file));
			}
		}
		expect(violations).toEqual([]);
	});
});
