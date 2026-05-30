import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const skillPath = "skills/fire-review/SKILL.md";

async function readSkill(): Promise<string> {
	return await readFile(skillPath, "utf8");
}

describe("fire-review skill", () => {
	it("declares reusable skill metadata", async () => {
		const content = await readSkill();

		expect(content).toContain("name: fire-review");
		expect(content).toContain("Dan Ward F.I.R.E. repo/codebase review skill");
		expect(content).toContain("FIRE review");
	});

	it("documents the required review contract", async () => {
		const content = await readSkill();

		for (const requiredText of [
			"## Triggers",
			"## Workflow",
			"## Evidence checklist",
			"## Verdict semantics",
			"## Output template",
			"## Guardrails",
			"## Verification guidance",
			"git diff --check",
			"api[_-]?key",
			"PASS with follow-ups",
			"BLOCKED",
		]) {
			expect(content).toContain(requiredText);
		}
	});
});
