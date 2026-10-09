/** Documentation hygiene architecture fitness functions. */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MAX_ACTIVE_ROOT_DOCS = 3;

const SKIP_DIRS = new Set([
	".git",
	".pi",
	".venv-semgrep",
	".workers",
	"build",
	"coverage",
	"dist",
	"dist-npm",
	"node_modules",
	"out",
]);

function markdownFiles(root: string): string[] {
	const files: string[] = [];
	if (!existsSync(root)) return files;
	for (const entry of readdirSync(root)) {
		if (SKIP_DIRS.has(entry)) continue;
		const path = join(root, entry);
		if (statSync(path).isDirectory()) files.push(...markdownFiles(path));
		else if (path.endsWith(".md")) files.push(relative(process.cwd(), path));
	}
	return files;
}

/** Drop fenced code blocks so illustrative `[text](path)` examples are not link-checked. */
function stripFencedCode(markdown: string): string {
	const lines: string[] = [];
	let inFence = false;
	for (const line of markdown.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (!inFence) lines.push(line);
	}
	return lines.join("\n");
}

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;

function relativeLinkTargets(markdown: string): string[] {
	return [...stripFencedCode(markdown).matchAll(MARKDOWN_LINK)]
		.map((match) => (match[1] ?? "").trim().replace(/^<|>$/g, ""))
		.filter((target) => target.length > 0 && !/^(https?:|mailto:|#|\/)/.test(target));
}

describe("docs hygiene", () => {
	it("docs root stays small and active-reference focused", () => {
		const rootDocs = markdownFiles("docs")
			.filter((path) => path.split("/").length === 2)
			.filter((path) => basename(path) !== "README.md");

		expect(rootDocs.length).toBeLessThanOrEqual(MAX_ACTIVE_ROOT_DOCS);
	});

	it("keeps superseded archives, deep dives and specs out of the active tree", () => {
		const activePaths = markdownFiles("docs");
		const stalePaths = activePaths.filter((path) =>
			[
				"docs/archive/",
				"docs/deep-dives/",
				"docs/adr/",
				"docs/reports/",
				"docs/plans/",
				"docs/specs/",
			].some((root) => path.startsWith(root)),
		);

		expect(stalePaths).toEqual([]);
	});

	it("decision log uses one SPR line per decision", () => {
		const content = readFileSync("docs/decisions.md", "utf8");
		const entries = [...content.matchAll(/^- (\d{3}) (.+)$/gm)];
		expect(entries.length).toBeGreaterThanOrEqual(60);
		expect(content).toContain("Sparse Priming Representation");
		for (const entry of entries) expect(entry[2] ?? "", entry[1]).toContain("—");
	});

	it("relative links in tracked Markdown resolve", () => {
		const broken: string[] = [];
		for (const file of markdownFiles(".")) {
			for (const target of relativeLinkTargets(readFileSync(file, "utf8"))) {
				const clean = (target.split("#")[0] ?? "").split("?")[0] ?? "";
				if (clean.length === 0) continue;
				if (!existsSync(resolve(dirname(file), clean))) broken.push(`${file} -> ${target}`);
			}
		}

		expect(broken).toEqual([]);
	});
});
