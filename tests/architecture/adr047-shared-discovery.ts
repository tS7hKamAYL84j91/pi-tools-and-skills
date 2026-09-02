/** ADR-047 dependency and neutral-shared-library fitness checks. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

const DISCOVERY_PATH = "lib/declarative-discovery.ts";
const EXTENSION_IMPORT = /from\s+["'](?:\.\.\/)+extensions\//;
const PANOPTICON_IMPORT = /from\s+["'][^"']*pi-panopticon\//;
const BOOST_IMPORT = /from\s+["'][^"']*pi-boost\//;

function source(path: string): string {
	return readFileSync(path, "utf8");
}

describe("ADR-047 shared declarative discovery", () => {
	it("keeps lib neutral: it has no extension dependency or domain descriptor policy", () => {
		const discovery = source(DISCOVERY_PATH);
		expect(discovery).not.toMatch(EXTENSION_IMPORT);
		expect(discovery).not.toMatch(/pi-panopticon|pi-boost|team(?:Id)?|enablementId|principalIssuerId|provider|model|lease/i);
	});

	it("keeps pi-panopticon and pi-boost free of cross-extension imports", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions/pi-panopticon")) {
			if (BOOST_IMPORT.test(source(file))) violations.push(relative(process.cwd(), file));
		}
		for (const file of listTsFiles("extensions/pi-boost")) {
			if (PANOPTICON_IMPORT.test(source(file))) violations.push(relative(process.cwd(), file));
		}
		expect(violations).toEqual([]);
	});

	it("uses the neutral primitive in pi-teams and has no Boost config.json fallback", () => {
		expect(source("extensions/pi-teams/team-paths.ts")).toContain("lib/declarative-discovery.js");
		const configFallbacks = listTsFiles("extensions/pi-boost")
			.filter((file) => /config\.json/.test(source(file)))
			.map((file) => relative(process.cwd(), file));
		expect(configFallbacks).toEqual([]);
	});
});
