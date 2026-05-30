/** Documentation hygiene architecture fitness functions. */

import { readFileSync } from "node:fs";
import { basename, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles } from "./helpers.js";

const MAX_ACTIVE_ROOT_DOCS = 3;
const MAX_ACTIVE_REPORTS = 8;
const MAX_DEEP_DIVES = 8;

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

	it("deep dives stay bounded and out of the root docs directory", () => {
		const deepDives = markdownFiles("docs/deep-dives");

		expect(deepDives.length).toBeLessThanOrEqual(MAX_DEEP_DIVES);
	});

	it("reports directory is active-only and capped", () => {
		const reports = markdownFiles("docs/reports")
			.filter((path) => basename(path) !== "README.md");
		const inactiveReports = reports.filter((path) => !hasActiveStatus(path));

		expect(reports.length).toBeLessThanOrEqual(MAX_ACTIVE_REPORTS);
		expect(inactiveReports).toEqual([]);
	});

	it("completed reports are not kept in the active reports directory", () => {
		const forbiddenStatusPattern = /^Status:\s*(?:complete|completed|done|superseded|archived)\s*$/im;
		const violations = markdownFiles("docs/reports")
			.filter((path) => forbiddenStatusPattern.test(readFileSync(path, "utf8")));

		expect(violations).toEqual([]);
	});
});
