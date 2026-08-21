/** Documentation hygiene architecture fitness functions. */

import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles } from "./helpers.js";

const MAX_ACTIVE_ROOT_DOCS = 3;

function markdownFiles(root: string): string[] {
	return listFiles(root, [".md"]).map((file) => relative(process.cwd(), file));
}

function hasActiveStatus(path: string): boolean {
	return /^Status:\s*active\s*$/m.test(readFileSync(path, "utf8"));
}

describe("docs hygiene", () => {
	it("docs root stays small and active-reference focused", () => {
		const rootDocs = markdownFiles("docs")
			.filter((path) => path.split("/").length === 2)
			.filter((path) => basename(path) !== "README.md");

		expect(rootDocs.length).toBeLessThanOrEqual(MAX_ACTIVE_ROOT_DOCS);
	});

	it("keeps superseded archives and deep dives out of the active tree", () => {
		const activePaths = markdownFiles("docs");
		const stalePaths = activePaths.filter((path) =>
			path.startsWith("docs/archive/") || path.startsWith("docs/deep-dives/"),
		);

		expect(stalePaths).toEqual([]);
	});

	it("keeps only explicitly active reports", () => {
		const inactiveReports = markdownFiles("docs/reports")
			.filter((path) => basename(path) !== "README.md")
			.filter((path) => !hasActiveStatus(path));

		expect(inactiveReports).toEqual([]);
	});
});
