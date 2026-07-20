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
	readonly createdAt: string;
	readonly targetDate: string;
}

interface ModuleDefinition {
	readonly name: string;
	readonly pathPrefix: string;
}

interface CouplingBudget {
	readonly modules: readonly [string, string];
	readonly maxCommits90d: number;
	readonly reason: string;
	readonly createdAt: string;
	readonly targetDate: string;
}

interface HotspotMetric {
	readonly path: string;
	readonly lines: number;
	readonly churn90d: number;
	readonly complexity: number;
	readonly score: number;
}

const EXTENSION_DEFAULT_MAX_LINES = 300;
const LIB_DEFAULT_MAX_LINES = 200;
const TOP_HOTSPOT_REFACTOR_GATE = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(start: string, end: string): number {
	return (new Date(end).getTime() - new Date(start).getTime()) / MS_PER_DAY;
}

const LINE_BUDGET_EXCEPTIONS: LineBudgetException[] = [
	{
		path: "extensions/pi-panopticon/teams/team-handler-fusion-analysis.ts",
		maxLines: 360,
		reason:
			"Fusion analysis protocol panel/judge helpers; extract a dedicated fusion-node module when adding another fusion-style protocol.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-coas/schedules.ts",
		maxLines: 360,
		reason:
			"Refactored I/O behavior; extract parsing logic or API interface before adding more schedules code.",
		createdAt: "2026-07-20",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-goal/goal-extension.ts",
		maxLines: 650,
		reason:
			"Established goal tool/command entrypoint; split registration from state flow when touched.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-goal/state.ts",
		maxLines: 350,
		reason:
			"Established goal state persistence; extract versioned helpers on schema changes.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-kanban/board.ts",
		maxLines: 470,
		reason:
			"Kanban event parser hotspot; extract typed event handlers when syntax grows.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-kanban/overlay-render.ts",
		maxLines: 435,
		reason:
			"Kanban overlay renderer hotspot; extract section renderers when adding UI states.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-kanban/overlay.ts",
		maxLines: 460,
		reason:
			"Kanban overlay interaction hotspot; split navigation/input concerns when modified.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-kanban/task-tools.ts",
		maxLines: 325,
		reason:
			"Kanban task tool hotspot; split command families when adding mutations.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/ui/agent-overlay.ts",
		maxLines: 460,
		reason:
			"Established agent TUI flow; extract focused view helpers when modified.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/teams/state.ts",
		maxLines: 540,
		reason:
			"Team run state serialization expanded for ADR 027 node observability; extract versioned codecs on the next schema change.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/teams/team-overlay.ts",
		maxLines: 430,
		reason:
			"Team overlay renderer; extract render helpers when adding UI states.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/registry/registry.ts",
		maxLines: 420,
		reason:
			"Registry lifecycle/persistence; extract sync persistence helpers when touched.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/spawner/spawner-tools.ts",
		maxLines: 405,
		reason:
			"Spawner tool surface; split prompt-file/RPC helpers on new behavior.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/teams/team-runtime.ts",
		maxLines: 500,
		reason:
			"Team runtime control expanded for ADR 027 node observability; extract team control tools before adding more runtime surfaces.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/teams/team-registry.ts",
		maxLines: 350,
		reason:
			"Team manifest registry; extract manifest IO/merge helpers when expanded.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/registry/health.ts",
		maxLines: 370,
		reason:
			"Agent health heuristics and aggregate observability; keep detection helpers pure and bounded.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		path: "extensions/pi-panopticon/messaging/messaging.ts",
		maxLines: 325,
		reason:
			"Messaging tool surface; extract channel/tool families when adding transports.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
];

const MODULES: ModuleDefinition[] = [
	{ name: "panopticon-ui", pathPrefix: "extensions/pi-panopticon/ui/" },
	{
		name: "panopticon-registry",
		pathPrefix: "extensions/pi-panopticon/registry/",
	},
	{
		name: "panopticon-messaging",
		pathPrefix: "extensions/pi-panopticon/messaging/",
	},
	{
		name: "panopticon-spawner",
		pathPrefix: "extensions/pi-panopticon/spawner/",
	},
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
		reason:
			"Teams intentionally uses shared runtime child-process/control-plane adapters. Decoupling plan target 2026-09-22: extract runtime-control adapters to lib/runtime-control-plane to reduce co-change.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["panopticon-registry", "panopticon-spawner"],
		maxCommits90d: 10,
		reason:
			"Spawner publishes parent/visibility metadata through the agent registry. Decoupling plan target 2026-09-22: move spawn metadata exchange to a narrow registry event bus.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["panopticon-messaging", "panopticon-registry"],
		maxCommits90d: 10,
		reason:
			"Messaging resolves visible peers through registry metadata. Decoupling plan target 2026-09-22: cache visibility snapshots in messaging so registry schema changes do not require messaging edits.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["panopticon-ui", "panopticon-registry"],
		maxCommits90d: 10,
		reason:
			"UI renders agent registry and health metadata. Decoupling plan target 2026-09-22: introduce a stable view-model so UI only changes on intentional health schema updates.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["coas", "kanban"],
		maxCommits90d: 6,
		reason:
			"Recent setup/docs/package changes touched orchestration extensions together; avoid further runtime coupling. Decoupling plan target 2026-09-22: keep shared surface limited to docs/package metadata, no runtime calls.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["kanban", "matrix"],
		maxCommits90d: 6,
		reason:
			"Recent setup/docs/package changes touched communication/task extensions together; avoid further runtime coupling. Decoupling plan target 2026-09-22: keep shared surface limited to docs/package metadata, no runtime calls.",
		createdAt: "2026-06-24",
		targetDate: "2026-09-22",
	},
	{
		modules: ["coas", "matrix"],
		maxCommits90d: 5,
		reason:
			"One-time package metadata alignment (engines.node) across orchestration and communication extensions. Decoupling plan target 2026-09-22: no shared runtime surface; manifests remain independent.",
		createdAt: "2026-07-11",
		targetDate: "2026-09-22",
	},
	{
		modules: ["goal", "kanban"],
		maxCommits90d: 5,
		reason:
			"One-time package metadata alignment (engines.node) across lifecycle and task extensions. Decoupling plan target 2026-09-22: no shared runtime surface; manifests remain independent.",
		createdAt: "2026-07-11",
		targetDate: "2026-09-22",
	},
	{
		modules: ["kanban", "lib"],
		maxCommits90d: 5,
		reason:
			"One-time package metadata alignment (engines.node) and shared test helper changes touched kanban and lib. Decoupling plan target 2026-09-22: limit kanban/lib shared surface to already-extracted helpers; no new runtime coupling.",
		createdAt: "2026-07-11",
		targetDate: "2026-09-22",
	},
];

function lineCount(path: string): number {
	return readFileSync(path, "utf8").split("\n").length;
}

function lineCountText(content: string): number {
	return content.split("\n").length;
}

function complexityApprox(content: string): number {
	return [
		...content.matchAll(/\b(if|for|while|case|catch|switch)\b|&&|\|\||\?/g),
	].length;
}

function budgetFor(path: string): LineBudgetException | undefined {
	return LINE_BUDGET_EXCEPTIONS.find((exception) => exception.path === path);
}

function defaultLineBudget(path: string): number {
	return path.startsWith("lib/")
		? LIB_DEFAULT_MAX_LINES
		: EXTENSION_DEFAULT_MAX_LINES;
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

function changedFilesSinceMergeBase(): Set<string> {
	let base = "";
	try {
		base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
			encoding: "utf8",
		}).trim();
	} catch {
		return new Set<string>();
	}
	const committed = gitLines([
		"diff",
		"--name-only",
		`${base}...HEAD`,
		"--",
		"extensions",
		"lib",
	]);
	const workingTree = gitLines([
		"diff",
		"--name-only",
		"HEAD",
		"--",
		"extensions",
		"lib",
	]);
	return new Set(
		[...committed, ...workingTree].filter((path) => path.endsWith(".ts")),
	);
}

function textAtRevision(revision: string, path: string): string | undefined {
	try {
		return execFileSync("git", ["show", `${revision}:${path}`], {
			encoding: "utf8",
		});
	} catch {
		return undefined;
	}
}

function churnByFile90d(): Map<string, number> {
	const counts = new Map<string, number>();
	for (const file of gitLines([
		"log",
		"--since=90 days ago",
		"--name-only",
		"--pretty=format:",
		"--",
		"extensions",
		"lib",
	])) {
		if (file.endsWith(".ts")) {
			counts.set(file, (counts.get(file) ?? 0) + 1);
		}
	}
	return counts;
}

function hotspotMetrics(): HotspotMetric[] {
	const churn = churnByFile90d();
	return [...listTsFiles("extensions"), ...listTsFiles("lib")]
		.map((file) => relative(process.cwd(), file))
		.map((path) => {
			const content = readFileSync(path, "utf8");
			const lines = lineCountText(content);
			const complexity = complexityApprox(content);
			const churn90d = churn.get(path) ?? 0;
			return {
				path,
				lines,
				churn90d,
				complexity,
				score: lines * Math.max(churn90d, 1) * Math.max(complexity, 1),
			};
		})
		.sort(
			(first, second) =>
				second.score - first.score || first.path.localeCompare(second.path),
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
			.map((path) => ({
				path,
				lines: lineCount(path),
				budget: budgetFor(path),
			}))
			.filter(
				(file) =>
					file.lines > (file.budget?.maxLines ?? defaultLineBudget(file.path)),
			)
			.map((file) => {
				const maxLines = file.budget?.maxLines ?? defaultLineBudget(file.path);
				const reason =
					file.budget?.reason ??
					"Split the module or add a justified hotspot budget.";
				return `${file.path}: ${file.lines}/${maxLines} lines — ${reason}`;
			});

		expect(violations).toEqual([]);
	});

	it("line-budget exceptions include remediation guidance", () => {
		const missingReasons = LINE_BUDGET_EXCEPTIONS.filter(
			(exception) => exception.reason.trim().length < 20,
		).map((exception) => exception.path);

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
		const unexpectedRootFiles = rootFiles.filter(
			(path) => !allowedRootFiles.has(path),
		);
		const oversizedRootFiles = rootFiles
			.map((path) => ({ path, lines: lineCount(path) }))
			.filter((file) => file.lines > 150)
			.map((file) => `${file.path}: ${file.lines} lines`);

		expect(unexpectedRootFiles).toEqual([]);
		expect(oversizedRootFiles).toEqual([]);
	});

	it("changes to top combined hotspots must reduce size or complexity", () => {
		const changedFiles = changedFilesSinceMergeBase();
		const topHotspots = hotspotMetrics().slice(0, TOP_HOTSPOT_REFACTOR_GATE);
		const topHotspotPaths = new Set(topHotspots.map((hotspot) => hotspot.path));
		const currentNumberOne = topHotspots[0]?.path;
		const violations = [...changedFiles]
			.filter((path) => topHotspotPaths.has(path) || path === currentNumberOne)
			.map((path) => {
				const base = execFileSync(
					"git",
					["merge-base", "origin/main", "HEAD"],
					{ encoding: "utf8" },
				).trim();
				const previous = textAtRevision(base, path);
				if (!previous) {
					return undefined;
				}
				const current = readFileSync(path, "utf8");
				const previousLines = lineCountText(previous);
				const currentLines = lineCountText(current);
				const previousComplexity = complexityApprox(previous);
				const currentComplexity = complexityApprox(current);
				if (
					currentLines < previousLines ||
					currentComplexity < previousComplexity
				) {
					return undefined;
				}
				return `${path}: top-${TOP_HOTSPOT_REFACTOR_GATE} hotspot changed without reducing lines (${previousLines}->${currentLines}) or complexity (${previousComplexity}->${currentComplexity}); refactor while touching it.`;
			})
			.filter((violation): violation is string => violation != null);

		expect(violations).toEqual([]);
	});

	it("line-budget exceptions have a target date within 90 days of creation", () => {
		const violations = LINE_BUDGET_EXCEPTIONS.filter(
			(exception) =>
				Number.isNaN(new Date(exception.createdAt).getTime()) ||
				Number.isNaN(new Date(exception.targetDate).getTime()) ||
				daysBetween(exception.createdAt, exception.targetDate) > 90,
		).map((exception) => exception.path);
		expect(violations).toEqual([]);
	});

	it("line-budget exception reasons do not use open-ended deferral language", () => {
		const vague = /\b(later|legacy)\b/i;
		const violations = LINE_BUDGET_EXCEPTIONS.filter((exception) =>
			vague.test(exception.reason),
		).map((exception) => exception.path);
		expect(violations).toEqual([]);
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
			.filter(
				([pair, count]) => count > (budgets.get(pair)?.maxCommits90d ?? 4),
			)
			.map(([pair, count]) => {
				const budget = budgets.get(pair);
				const limit = budget?.maxCommits90d ?? 4;
				const reason =
					budget?.reason ??
					"Unexpected repeated co-change across module boundaries.";
				return `${pair}: ${count}/${limit} commits in 90d — ${reason}`;
			});

		expect(violations).toEqual([]);
	});

	it("temporal-coupling exceptions include remediation guidance", () => {
		const missingReasons = COUPLING_BUDGETS.filter(
			(budget) => budget.reason.trim().length < 20,
		).map((budget) => budget.modules.join(" <-> "));

		expect(missingReasons).toEqual([]);
	});

	it("temporal-coupling exceptions above the default include a bounded decoupling plan", () => {
		const defaultThreshold = 4;
		const violations = COUPLING_BUDGETS.filter(
			(budget) => budget.maxCommits90d > defaultThreshold,
		)
			.filter((budget) => {
				const createdMs = new Date(budget.createdAt).getTime();
				const targetMs = new Date(budget.targetDate).getTime();
				return (
					Number.isNaN(createdMs) ||
					Number.isNaN(targetMs) ||
					daysBetween(budget.createdAt, budget.targetDate) > 90 ||
					budget.reason.trim().length < 20
				);
			})
			.map((budget) => budget.modules.join(" <-> "));

		expect(violations).toEqual([]);
	});
});
