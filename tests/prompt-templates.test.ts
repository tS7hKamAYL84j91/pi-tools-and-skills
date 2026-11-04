/** Slash-command templates: every Markdown file in prompts/ is a command. */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PROMPTS_DIR = join(process.cwd(), "prompts");

function templates(): string[] {
	return readdirSync(PROMPTS_DIR)
		.filter((name) => name.endsWith(".md"))
		.sort();
}

function frontmatter(name: string): Record<string, string> {
	const content = readFileSync(join(PROMPTS_DIR, name), "utf8");
	const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
	if (!match?.[1]) throw new Error(`${name} has no frontmatter block`);
	return Object.fromEntries(
		match[1]
			.split("\n")
			.map((line) => /^([a-z-]+):\s*(.+)$/.exec(line))
			.filter((entry): entry is RegExpExecArray => entry !== null)
			.map((entry) => [entry[1] as string, entry[2] as string]),
	);
}

describe("prompt templates", () => {
	it("ships templates from the package manifest", () => {
		const manifest = JSON.parse(
			readFileSync(join(process.cwd(), "package.json"), "utf8"),
		) as { pi?: { prompts?: string[] }; files?: string[] };

		expect(manifest.pi?.prompts).toContain("./prompts");
		expect(manifest.files).toContain("prompts");
	});

	it("gives every template a description and a body", () => {
		const names = templates();
		expect(names.length).toBeGreaterThan(0);

		for (const name of names) {
			// A stray README.md or notes.md would ship as /README or /notes.
			const fields = frontmatter(name);
			expect(fields.description, `${name} description`).toBeTruthy();
			const body = readFileSync(join(PROMPTS_DIR, name), "utf8")
				.replace(/^---\n[\s\S]*?\n---\n/, "")
				.trim();
			expect(body.length, `${name} body`).toBeGreaterThan(80);
		}
	});
});
