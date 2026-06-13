import { describe, expect, it } from "vitest";
import { checkTemplateSafety, formatTemplateSafetyResult } from "../lib/template-safety.js";

describe("template safety checker", () => {
	it("passes explicit public fixture paths", async () => {
		const result = await checkTemplateSafety(["tests/fixtures/template-safety/public-pack/review-template.md"]);

		expect(result.checked).toEqual(["tests/fixtures/template-safety/public-pack/review-template.md"]);
		expect(result.findings).toEqual([]);
		expect(formatTemplateSafetyResult(result)).toContain("PASS");
	});

	it("reports deterministic findings for unsafe synthetic fixtures", async () => {
		const result = await checkTemplateSafety(["tests/fixtures/template-safety/unsafe-pack/unsafe-template.md"]);

		expect(result.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining([
			"secret-placeholder",
			"private-path",
			"raw-session-request",
		]));
		expect(result.findings).toHaveLength(4);
		expect(formatTemplateSafetyResult(result)).toContain("FAIL");
	});

	it("refuses non-fixture paths instead of scanning the workspace", async () => {
		await expect(checkTemplateSafety(["README.md"])).rejects.toThrow(/explicit synthetic fixture paths/);
	});
});
