/** Architecture fitness checks for the standalone pi-teams package boundary. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
	return readFileSync(path, "utf8");
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

	it("keeps Teams and swarm registration out of Panopticon", () => {
		expect(source("extensions/pi-panopticon/index.ts")).not.toMatch(/teams|swarm/i);
		expect(source("extensions/pi-panopticon/package.json")).not.toContain("teams");
	});

	it("documents independent installation and root setup wiring", () => {
		expect(source("extensions/pi-teams/README.md")).toContain("Standalone declarative team workflows");
		expect(source("README.md")).toContain("pi-teams");
		expect(source("Makefile")).toContain("PACKAGE=pi-goal|pi-matrix|pi-panopticon|pi-teams");
		expect(source("scripts/setup-pi")).toContain("pi-teams");
		expect(source("scripts/pi-package-settings.py")).toContain('"pi-teams"');
	});
});
