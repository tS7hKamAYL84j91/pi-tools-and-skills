import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const skillPath = "skills/spr-document-compression/SKILL.md";
const referencesPath = "skills/spr-document-compression/references/spr-prompts.md";

describe("spr-document-compression skill", () => {
	it("declares reusable skill metadata", async () => {
		const content = await readFile(skillPath, "utf8");

		expect(content).toContain("name: spr-document-compression");
		expect(content).toContain("Sparse Priming Representation");
		expect(content).toContain("lossy");
	});

	it("documents the compress/decompress workflow and guardrails", async () => {
		const content = await readFile(skillPath, "utf8");

		for (const requiredText of ["## When to use", "## Workflow", "## Output shape", "## Examples", "## Guardrails", "Decompress", "lossy"]) {
			expect(content).toContain(requiredText);
		}
	});

	it("ships the canonical generator and decompressor prompts", async () => {
		const content = await readFile(referencesPath, "utf8");

		expect(content).toContain("SPR Generator (compress)");
		expect(content).toContain("SPR Decompressor (expand)");
		expect(content).toContain("# MISSION");
		expect(content).toContain("# METHODOLOGY");
		expect(content).toContain("complete sentences");
	});
});