/** Architecture fitness checks for the standalone pi-team-workflows package boundary. */

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

describe("pi-team-workflows public ownership boundary", () => {
	it("has a standalone package manifest and skill bundle", () => {
		const manifest = JSON.parse(source("extensions/pi-team-workflows/package.json")) as {
			name?: string;
			pi?: { extensions?: string[]; skills?: string[] };
		};
		expect(manifest).toMatchObject({
			name: "pi-team-workflows",
			pi: {
				extensions: ["./index.ts"],
				skills: ["./skills"],
			},
		});
	});

	it("keeps Team Workflows registration out of Agent Hub", () => {
		expect(source("extensions/pi-agent-hub/index.ts")).not.toMatch(/teams/i);
		expect(source("extensions/pi-agent-hub/package.json")).not.toContain("teams");
	});

	it("documents independent installation and root setup wiring", () => {
		expect(source("extensions/pi-team-workflows/README.md")).toContain("Standalone declarative team workflows");
		expect(source("README.md")).toContain("pi-team-workflows");
		expect(source("Makefile")).toContain("PACKAGE=pi-goal|pi-matrix|pi-ollama-models|pi-agent-hub|pi-team-workflows");
		expect(source("scripts/setup-pi")).toContain("pi-team-workflows");
		expect(source("scripts/pi-package-settings.py")).toContain('"pi-team-workflows"');
	});

	it("contains zero active fusion-analysis routes across pi-team-workflows, tests/team-workflows, and tests/evals", () => {
		const targetDirs = ["extensions/pi-team-workflows", "tests/team-workflows", "tests/evals"];
		const allFiles = targetDirs.flatMap(collectFiles);
		const offendingFiles = allFiles.filter((filePath) => {
			// Allow intentional decommission documentation in README.md
			if (filePath.endsWith("extensions/pi-team-workflows/README.md")) return false;
			const content = readFileSync(filePath, "utf8");
			return content.includes("fusion-analysis");
		});
		expect(offendingFiles).toEqual([]);
	});
});
