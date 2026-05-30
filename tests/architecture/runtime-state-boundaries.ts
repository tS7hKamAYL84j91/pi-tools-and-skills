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

interface DirectWriteException {
	readonly path: string;
	readonly reason: string;
}

const STATE_OWNERSHIP_RULES: StateOwnershipRule[] = [
	{
		owner: "pi-coas",
		label: "CoAS state",
		patterns: [/\bCOAS_HOME\b/, /\bcoasHome\b/, /["'`]\.coas["'`]/],
	},
	{ owner: "pi-goal", label: "Goal state", patterns: [/\.pi(?:\/|\\\\)goal\b/] },
	{
		owner: "pi-kanban",
		label: "Kanban state",
		patterns: [/["'`]pi-kanban[\\/]/, /\bboard\.log\b/],
	},
	{
		owner: "pi-matrix",
		label: "Matrix state",
		patterns: [/matrix-sync\b/, /matrix-attachments\b/],
	},
	{
		owner: "pi-panopticon",
		label: "Panopticon registry",
		patterns: [/\bREGISTRY_DIR\b/],
	},
	{ owner: "pi-panopticon", label: "Teams run state", patterns: [/pi-teams:run\b/] },
];

const DIRECT_STATE_WRITE_EXCEPTIONS: DirectWriteException[] = [
	{
		path: "extensions/pi-coas/store.ts",
		reason: "Existing local atomic helper; migrate in a later AFR-002 slice.",
	},
	{
		path: "extensions/pi-coas/schedules.ts",
		reason: "CoAS append log migration remains a later AFR-002 slice.",
	},
	{
		path: "extensions/pi-coas/workspaces.ts",
		reason: "CoAS workspace journal migration remains a later AFR-002 slice.",
	},
	{
		path: "extensions/pi-coas/scheduler.ts",
		reason: "CoAS scheduler log migration remains a later AFR-002 slice.",
	},
	{
		path: "extensions/pi-kanban/compaction.ts",
		reason:
			"Board-log replacement semantics need a dedicated compaction migration.",
	},
	{
		path: "extensions/pi-matrix/attachments.ts",
		reason:
			"Binary attachment writes are content downloads, not shared control state.",
	},
	{
		path: "extensions/pi-panopticon/registry/registry.ts",
		reason:
			"Synchronous lifecycle registry write; needs sync helper or documented exception.",
	},
	{
		path: "extensions/pi-panopticon/spawner/spawner-tools.ts",
		reason: "Writes one-off prompt file before process spawn.",
	},
	{
		path: "extensions/pi-panopticon/teams/team-form.ts",
		reason:
			"Interactive sync authoring flow; needs sync helper or async refactor.",
	},
	{
		path: "lib/agent-registry.ts",
		reason: "Synchronous process registry lifecycle code.",
	},
	{
		path: "lib/session-hook-installer.ts",
		reason: "Hook installer write migration remains a later AFR-002 slice.",
	},
	{
		path: "lib/session-spool.ts",
		reason: "Existing local atomic helper; migrate in a later AFR-002 slice.",
	},
	{
		path: "lib/transports/maildir.ts",
		reason: "Maildir protocol requires its own tmp/new rename semantics.",
	},
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
						violations.push(
							`${relativeFile} references ${rule.label} marker ${pattern}`,
						);
					}
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("state-writing code uses shared persistence helpers or explicit exceptions", () => {
		const exceptionPaths = new Set(
			DIRECT_STATE_WRITE_EXCEPTIONS.map((exception) => exception.path),
		);
		const directWriteImportPattern =
			/import\s*\{[^}]*\b(?:writeFile|appendFile|writeFileSync)\b[^}]*\}\s*from\s*["']node:fs(?:\/promises)?["']/;
		const violations = [...listTsFiles("extensions"), ...listTsFiles("lib")]
			.map((file) => relative(process.cwd(), file))
			.filter((file) => !exceptionPaths.has(file))
			.filter((file) =>
				directWriteImportPattern.test(readFileSync(file, "utf8")),
			);

		expect(violations).toEqual([]);
		expect(
			DIRECT_STATE_WRITE_EXCEPTIONS.every(
				(exception) => exception.reason.length > 0,
			),
		).toBe(true);
	});

	it("Panopticon teams direct child process lifecycle remains explicitly bounded", () => {
		const allowed = new Set([
			"extensions/pi-panopticon/teams/worktree-isolation.ts",
		]);
		const childProcessImportPattern = /from\s+["']node:child_process["']/;
		const violations = listTsFiles("extensions/pi-panopticon/teams")
			.map((file) => relative(process.cwd(), file))
			.filter((file) => !allowed.has(file))
			.filter((file) =>
				childProcessImportPattern.test(readFileSync(file, "utf8")),
			);

		expect(violations).toEqual([]);
	});
});

describe("render path safety", () => {
	it("readAllPeers must not be called inside render() closures", async () => {
		const rule = projectFiles()
			.inFolder("extensions/pi-panopticon/**")
			.should()
			.adhereTo((file) => {
				const renderPattern =
					/render\s*\([^)]*\)\s*(?::\s*\w+(?:\[\])?\s*)?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g;
				for (const match of file.content.matchAll(renderPattern)) {
					if (match[1]?.includes("readAllPeers")) return false;
				}
				return true;
			}, "readAllPeers() must not be called inside render() functions (causes sync I/O per paint frame)");
		await expect(rule).toPassAsync();
	});
});
