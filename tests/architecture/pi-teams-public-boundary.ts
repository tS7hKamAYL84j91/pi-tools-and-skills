/** Architecture fitness checks for the standalone pi-teams package boundary. */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
	return readFileSync(path, "utf8");
}

function collectFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const fullPath = join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			files.push(...collectFiles(fullPath));
		} else if (stat.isFile()) {
			files.push(fullPath);
		}
	}
	return files;
}

describe("pi-teams public ownership boundary", () => {
	it("has a standalone package manifest and skill bundle", () => {
		const manifest = JSON.parse(source("extensions/pi-teams/package.json")) as {
			name?: string;
			pi?: { extensions?: string[]; skills?: string[] };
		};
		expect(manifest).toMatchObject({
			name: "pi-teams",
			pi: {
				extensions: ["./index.ts"],
				skills: ["./skills"],
			},
		});
	});

	it("keeps Teams registration out of Panopticon", () => {
		expect(source("extensions/pi-panopticon/index.ts")).not.toMatch(/teams/i);
		expect(source("extensions/pi-panopticon/package.json")).not.toContain("teams");
	});

	it("documents independent installation and root setup wiring", () => {
		expect(source("extensions/pi-teams/README.md")).toContain("Standalone declarative team workflows");
		expect(source("README.md")).toContain("pi-teams");
		expect(source("Makefile")).toContain("PACKAGE=pi-goal|pi-matrix|pi-panopticon|pi-teams");
		expect(source("scripts/setup-pi")).toContain("pi-teams");
		expect(source("scripts/pi-package-settings.py")).toContain('"pi-teams"');
	});

	it("contains zero active fusion-analysis routes across pi-teams, tests/teams, and tests/evals", () => {
		const targetDirs = ["extensions/pi-teams", "tests/teams", "tests/evals"];
		const allFiles = targetDirs.flatMap(collectFiles);
		const offendingFiles = allFiles.filter((filePath) => {
			// Allow intentional decommission documentation in README.md
			if (filePath.endsWith("extensions/pi-teams/README.md")) return false;
			const content = readFileSync(filePath, "utf8");
			return content.includes("fusion-analysis");
		});
		expect(offendingFiles).toEqual([]);
	});
});
