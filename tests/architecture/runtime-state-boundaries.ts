/** Runtime state-boundary architecture fitness functions. */

import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

interface StateOwnershipRule {
	owner: string;
	label: string;
	patterns: RegExp[];
}

const STATE_OWNERSHIP_RULES: StateOwnershipRule[] = [
	{ owner: "pi-coas", label: "CoAS state", patterns: [/\bCOAS_HOME\b/, /\bcoasHome\b/, /["'`]\.coas["'`]/] },
	{ owner: "pi-goal", label: "Goal state", patterns: [/\.pi-goal\b/] },
	{ owner: "pi-kanban", label: "Kanban state", patterns: [/["'`]pi-kanban[\\/]/, /\bboard\.log\b/] },
	{ owner: "pi-matrix", label: "Matrix state", patterns: [/matrix-sync\b/, /matrix-attachments\b/] },
	{ owner: "pi-panopticon", label: "Panopticon registry", patterns: [/\bREGISTRY_DIR\b/] },
	{ owner: "pi-teams", label: "Teams run state", patterns: [/pi-teams:run\b/] },
];

describe("runtime state boundary", () => {
	it("extensions must not reach into another extension's private state", () => {
		const violations: string[] = [];
		for (const file of listTsFiles("extensions")) {
			const relativeFile = relative(process.cwd(), file);
			const [, sourceExtension] = relativeFile.split(sep);
			if (!sourceExtension) continue;
			const content = readFileSync(file, "utf8");

			for (const rule of STATE_OWNERSHIP_RULES) {
				if (rule.owner === sourceExtension) continue;
				for (const pattern of rule.patterns) {
					if (pattern.test(content)) {
						violations.push(`${relativeFile} references ${rule.label} marker ${pattern}`);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});
});

describe("render path safety", () => {
	it("readAllPeers must not be called inside render() closures", async () => {
		const rule = projectFiles()
			.inFolder("extensions/pi-panopticon/**")
			.should()
			.adhereTo((file) => {
				const renderPattern = /render\s*\([^)]*\)\s*(?::\s*\w+(?:\[\])?\s*)?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
				for (const match of file.content.matchAll(renderPattern)) {
					if (match[1]?.includes("readAllPeers")) return false;
				}
				return true;
			}, "readAllPeers() must not be called inside render() functions (causes sync I/O per paint frame)");
		await expect(rule).toPassAsync();
	});
});
