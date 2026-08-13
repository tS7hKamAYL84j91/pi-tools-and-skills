/** ADR-038 CoAS filesystem-capability fitness functions. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

const COAS_STORE_PATH = "extensions/pi-coas/store.ts";

function coasProductionSources(): Array<{ readonly path: string; readonly content: string }> {
	return listTsFiles("extensions/pi-coas").map((path) => ({
		path: relative(process.cwd(), path),
		content: readFileSync(path, "utf8"),
	}));
}

describe("ADR-038 CoAS confined IO", () => {
	it("keeps CoAS-owned filesystem primitives behind ConfinedStore", () => {
		const stateIoImport = /import\s*\{[^}]*(?:readFile|writeFile|appendFile|readdir|mkdir|rm|open|lstat|statfs|chmod)[^}]*\}\s*from\s*["']node:fs(?:\/promises)?["']/s;
		const violations = coasProductionSources()
			.filter((source) => source.path !== COAS_STORE_PATH)
			.filter((source) => stateIoImport.test(source.content))
			.map((source) => source.path);
		expect(violations).toEqual([]);
	});

	it("keeps shared persistence calls inside the confined capability", () => {
		const violations = coasProductionSources()
			.filter((source) => source.path !== COAS_STORE_PATH)
			.filter((source) => source.content.includes("lib/file-persistence"))
			.map((source) => source.path);
		expect(violations).toEqual([]);
	});

	it("does not restore legacy unbound filesystem helper exports", () => {
		const store = readFileSync(COAS_STORE_PATH, "utf8");
		const unsafeExports = [
			"ensurePrivateDir",
			"fileExists",
			"readOptionalFile",
			"writePrivateFileAtomic",
			"removePrivateFiles",
			"countDirectories",
			"newestFile",
		];
		const restored = unsafeExports.filter((name) => new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`).test(store));
		expect(restored).toEqual([]);
	});
});
