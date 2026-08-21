/** ADR-051 production-boundary fitness checks for pi-goal session isolation. */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

const PERSISTENCE = "extensions/pi-goal/goal-persist.ts";

function productionGoalSources(): Array<{ readonly path: string; readonly content: string }> {
	return listTsFiles("extensions/pi-goal")
		.map((file) => ({ path: relative(process.cwd(), file), content: readFileSync(file, "utf8") }))
		.filter((source) => source.path !== PERSISTENCE);
}

describe("ADR-051 pi-goal session boundary", () => {
	it("routes production persistence calls through a session scope", () => {
		const violations: string[] = [];
		for (const source of productionGoalSources()) {
			for (const match of source.content.matchAll(/\b(?:loadGoal|saveGoal|clearGoal|writeGoalIteration)\(([^\n]*)/g)) {
				if (match[1] !== undefined && !match[1].toLowerCase().includes("scope")) violations.push(source.path);
			}
		}
		expect(violations).toEqual([]);
	});

	it("declares private binding entries and confined instance roots", () => {
		const binding = readFileSync("extensions/pi-goal/goal-binding.ts", "utf8");
		const paths = readFileSync("extensions/pi-goal/goal-types.ts", "utf8");
		expect(binding).toContain('"pi-goal:binding"');
		expect(paths).toContain("instances");
		expect(paths).toContain("assertGoalId");
	});
});
