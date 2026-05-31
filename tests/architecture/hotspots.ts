/** Hotspot and temporal-coupling architecture fitness functions. */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { listTsFiles } from "./helpers.js";

interface LineBudgetException {
	readonly path: string;
	readonly maxLines: number;
	readonly reason: string;
}

interface ModuleDefinition {
	readonly name: string;
	readonly pathPrefix: string;
}

interface CouplingBudget {
	readonly modules: readonly [string, string];
	readonly maxCommits90d: number;
	readonly reason: string;
}

const EXTENSION_DEFAULT_MAX_LINES = 300;
const LIB_DEFAULT_MAX_LINES = 200;

const LINE_BUDGET_EXCEPTIONS: LineBudgetException[] = [
	{
		path: "extensions/pi-goal/goal-extension.ts",
		maxLines: 525,
		reason: "Legacy goal tool/command entrypoint; split registration from state flow when touched.",
	},
	{
		path: "extensions/pi-goal/state.ts",
		maxLines: 350,
		reason: "Legacy goal state persistence; extract versioned helpers on schema changes.",
	},
	{
		path: "extensions/pi-kanban/board.ts",
		maxLines: 470,
		reason: "Kanban event parser hotspot; extract typed event handlers when syntax grows.",
	},
	{
		path: "extensions/pi-kanban/overlay-render.ts",
		maxLines: 435,
		reason: "Kanban overlay renderer hotspot; extract section renderers when adding UI states.",
	},
	{
		path: "extensions/pi-kanban/overlay.ts",
		maxLines: 460,
		reason: "Kanban overlay interaction hotspot; split navigation/input concerns when modified.",
	},
	{
		path: "extensions/pi-kanban/task-tools.ts",
		maxLines: 325,
		reason: "Kanban task tool hotspot; split command families when adding mutations.",
	},
	{
		path: "extensions/pi-panopticon/ui/agent-overlay.ts",
		maxLines: 460,
		reason: "Legacy agent TUI flow; extract focused view helpers when modified.",
	},
	{
		path: "extensions/pi-panopticon/teams/state.ts",
		maxLines: 450,
		reason: "Team run state serialization; extract versioned codecs on schema changes.",
	},
	{
		path: "extensions/pi-panopticon/teams/team-overlay.ts",
		maxLines: 430,
		reason: "Team overlay renderer; extract render helpers when adding UI states.",
	},
	{
		path: "extensions/pi-panopticon/registry/registry.ts",
		maxLines: 420,
		reason: "Registry lifecycle/persistence; extract sync persistence helpers when touched.",
	},
	{
		path: "extensions/pi-panopticon/spawner/spawner-tools.ts",
		maxLines: 405,
		reason: "Spawner tool surface; split prompt-file/RPC helpers on new behavior.",
	},
	{
		path: "extensions/pi-panopticon/teams/team-runtime.ts",
		maxLines: 365,
		reason: "Team runtime control; keep protocol/runtime adapter boundaries explicit.",
	},
	{
		path: "extensions/pi-panopticon/teams/team-registry.ts",
		maxLines: 350,
		reason: "Team manifest registry; extract manifest IO/merge helpers when expanded.",
	},
	{
		path: "extensions/pi-panopticon/registry/health.ts",
		maxLines: 345,
		reason: "Agent health heuristics; keep detection helpers pure and bounded.",
	},
	{
		path: "extensions/pi-panopticon/messaging/messaging.ts",
		maxLines: 325,
		reason: "Messaging tool surface; extract channel/tool families when adding transports.",
	},
];

const MODULES: ModuleDefinition[] = [
	{ name: "panopticon-ui", pathPrefix: "extensions/pi-panopticon/ui/" },
	{ name: "panopticon-registry", pathPrefix: "extensions/pi-panopticon/registry/" },
	{ name: "panopticon-messaging", pathPrefix: "extensions/pi-panopticon/messaging/" },
	{ name: "panopticon-spawner", pathPrefix: "extensions/pi-panopticon/spawner/" },
	{ name: "panopticon-teams", pathPrefix: "extensions/pi-panopticon/teams/" },
	{ name: "kanban", pathPrefix: "extensions/pi-kanban/" },
	{ name: "goal", pathPrefix: "extensions/pi-goal/" },
	{ name: "matrix", pathPrefix: "extensions/pi-matrix/" },
	{ name: "coas", pathPrefix: "extensions/pi-coas/" },
	{ name: "lib", pathPrefix: "lib/" },
];

const COUPLING_BUDGETS: CouplingBudget[] = [
	{
		modules: ["panopticon-teams", "lib"],
		maxCommits90d: 14,
		reason: "Teams intentionally uses shared runtime child-process/control-plane adapters.",
	},
	{
		modules: ["panopticon-registry", "panopticon-spawner"],
		maxCommits90d: 10,
		reason: "Spawner publishes parent/visibility metadata through the agent registry.",
	},
	{
		modules: ["panopticon-messaging", "panopticon-registry"],
		maxCommits90d: 10,
		reason: "Messaging resolves visible peers through registry metadata.",
	},
	{
		modules: ["panopticon-ui", "panopticon-registry"],
		maxCommits90d: 10,
		reason: "UI renders agent registry and health metadata.",
	},
	{
		modules: ["coas", "kanban"],
		maxCommits90d: 5,
		reason: "Recent setup/docs/package changes touched orchestration extensions together; avoid further runtime coupling.",
	},
	{
		modules: ["kanban", "matrix"],
		maxCommits90d: 5,
		reason: "Recent setup/docs/package changes touched communication/task extensions together; avoid further runtime coupling.",
	},
];

function lineCount(path: string): number {
	return readFileSync(path, "utf8").split("\n").length;
}

function budgetFor(path: string): LineBudgetException | undefined {
	return LINE_BUDGET_EXCEPTIONS.find((exception) => exception.path === path);
}

function defaultLineBudget(path: string): number {
	return path.startsWith("lib/") ? LIB_DEFAULT_MAX_LINES : EXTENSION_DEFAULT_MAX_LINES;
}

function gitLines(args: string[]): string[] {
	return execFileSync("git", args, { encoding: "utf8" })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function moduleForPath(path: string): string | undefined {
	return MODULES.find((module) => path.startsWith(module.pathPrefix))?.name;
}

function sortedPair(first: string, second: string): string {
	return [first, second].sort().join(" <-> ");
}

function couplingBudgets(): Map<string, CouplingBudget> {
	return new Map(
		COUPLING_BUDGETS.map((budget) => [
			sortedPair(budget.modules[0], budget.modules[1]),
			budget,
		]),
	);
}

function changedModulesByCommit(): Map<string, Set<string>> {
	const commits = gitLines([
		"log",
		"--since=90 days ago",
		"--format=%H",
		"--",
		"extensions",
		"lib",
	]);
	const result = new Map<string, Set<string>>();
	for (const commit of commits) {
		const files = gitLines([
			"show",
			"--name-only",
			"--format=",
			commit,
			"--",
			"extensions",
			"lib",
		]);
		const modules = new Set<string>();
		for (const file of files) {
			const module = moduleForPath(file);
			if (module) {
				modules.add(module);
			}
		}
		result.set(commit, modules);
	}
	return result;
}

describe("line-count hotspot budgets", () => {
	it("source files stay within the default module line budget unless explicitly budgeted", () => {
		const violations = [...listTsFiles("extensions"), ...listTsFiles("lib")]
			.map((file) => relative(process.cwd(), file))
			.map((path) => ({ path, lines: lineCount(path), budget: budgetFor(path) }))
			.filter((file) => file.lines > (file.budget?.maxLines ?? defaultLineBudget(file.path)))
			.map((file) => {
				const maxLines = file.budget?.maxLines ?? defaultLineBudget(file.path);
				const reason = file.budget?.reason ?? "Split the module or add a justified hotspot budget.";
				return `${file.path}: ${file.lines}/${maxLines} lines — ${reason}`;
			});

		expect(violations).toEqual([]);
	});

	it("line-budget exceptions include remediation guidance", () => {
		const missingReasons = LINE_BUDGET_EXCEPTIONS
			.filter((exception) => exception.reason.trim().length < 20)
			.map((exception) => exception.path);

		expect(missingReasons).toEqual([]);
	});

	it("panopticon root stays a thin public entrypoint", () => {
		const allowedRootFiles = new Set([
			"extensions/pi-panopticon/index.ts",
			"extensions/pi-panopticon/types.ts",
		]);
		const rootFiles = listTsFiles("extensions/pi-panopticon")
			.map((path) => relative(process.cwd(), path))
			.filter((path) => path.split("/").length === 3);
		const unexpectedRootFiles = rootFiles.filter((path) => !allowedRootFiles.has(path));
		const oversizedRootFiles = rootFiles
			.map((path) => ({ path, lines: lineCount(path) }))
			.filter((file) => file.lines > 150)
			.map((file) => `${file.path}: ${file.lines} lines`);

		expect(unexpectedRootFiles).toEqual([]);
		expect(oversizedRootFiles).toEqual([]);
	});
});

describe("module temporal coupling", () => {
	it("module pairs stay below temporal-coupling thresholds unless budgeted", () => {
		const pairCounts = new Map<string, number>();
		for (const modules of changedModulesByCommit().values()) {
			const names = [...modules].sort();
			for (let i = 0; i < names.length; i++) {
				for (let j = i + 1; j < names.length; j++) {
					const first = names[i];
					const second = names[j];
					if (!first || !second) {
						continue;
					}
					const pair = sortedPair(first, second);
					pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
				}
			}
		}

		const budgets = couplingBudgets();
		const violations = [...pairCounts.entries()]
			.filter(([pair, count]) => count > (budgets.get(pair)?.maxCommits90d ?? 4))
			.map(([pair, count]) => {
				const budget = budgets.get(pair);
				const limit = budget?.maxCommits90d ?? 4;
				const reason = budget?.reason ?? "Unexpected repeated co-change across module boundaries.";
				return `${pair}: ${count}/${limit} commits in 90d — ${reason}`;
			});

		expect(violations).toEqual([]);
	});

	it("temporal-coupling exceptions include remediation guidance", () => {
		const missingReasons = COUPLING_BUDGETS
			.filter((budget) => budget.reason.trim().length < 20)
			.map((budget) => budget.modules.join(" <-> "));

		expect(missingReasons).toEqual([]);
	});
});
