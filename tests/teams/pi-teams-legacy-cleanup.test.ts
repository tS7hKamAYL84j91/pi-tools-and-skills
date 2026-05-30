/** Regression tests that prevent removed pi-teams legacy runtime from returning. */

import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles } from "../architecture/helpers.js";

describe("pi-teams legacy cleanup", () => {
	it("runtime files should not reintroduce removed legacy protocol symbols", () => {
		const forbidden = /\b(chairman|TeamRunDefinition|CouncilDefinition|CouncilMember|resolveCouncilSettings|LEGACY_TEAM_RUN_CUSTOM_TYPE|pi-teams:deliberation|TeamTopology|deliberate)\b/;
		const violations: string[] = [];
		for (const file of listFiles("extensions/pi-panopticon/teams", [".ts", ".md", ".json"])) {
			const content = readFileSync(file, "utf8");
			const match = forbidden.exec(content);
			if (match) {
				violations.push(`${relative(process.cwd(), file)} contains ${match[0]}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it("pi-teams runtime should not import the removed graph executor or lowering", () => {
		const forbidden = /from\s+["'].+\/(team-graph|team-lowering|protocol-contracts)\.js["']/;
		const violations: string[] = [];
		for (const file of listFiles("extensions/pi-panopticon/teams", [".ts"])) {
			const content = readFileSync(file, "utf8");
			const match = forbidden.exec(content);
			if (match) {
				violations.push(`${relative(process.cwd(), file)} imports ${match[1]}`);
			}
		}
		expect(violations).toEqual([]);
	});
});
