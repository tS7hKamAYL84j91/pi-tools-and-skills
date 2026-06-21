import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import type { TeamAgentBinding, TeamSpec } from "../../extensions/pi-panopticon/teams/team-types.js";

interface MockNode {
	ok: boolean;
	output: string;
	error?: string;
}

const calls: string[] = [];
const responses = new Map<string, MockNode>();

vi.mock("../../extensions/pi-panopticon/teams/team-node-runner.js", async () => {
	const actual = await vi.importActual<typeof import("../../extensions/pi-panopticon/teams/team-node-runner.js")>("../../extensions/pi-panopticon/teams/team-node-runner.js");
	return {
		...actual,
		runTeamNode: async (args: { role: string; binding: TeamAgentBinding; model: string }) => {
			calls.push(args.role);
			const response = responses.get(args.role) ?? { ok: true, output: args.role === "judge" ? JSON.stringify({ consensus: ["ok"], blindSpots: [] }) : `output from ${args.role}` };
			return {
				role: args.role,
				binding: args.binding,
				model: args.model,
				ok: response.ok,
				output: response.output,
				durationMs: 1,
				attempts: 1,
				...(response.error ? { error: response.error } : {}),
			};
		},
	};
});

const { getTeamHandler } = await import("../../extensions/pi-panopticon/teams/team-handlers.js");
const { planFusion } = await import("../../extensions/pi-panopticon/teams/team-handler-fusion-analysis.js");

function fusionAnalysisTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "fusion-analysis-test",
		name: "Fusion Analysis Test",
		protocol: "fusion-analysis",
		prompts: {},
		agents: ["fusion_panel", "fusion_judge"],
		agentBindings: [
			{ role: "panel", subagent: "fusion_panel", model: "test/a", tools: [] },
			{ role: "panel", subagent: "fusion_panel", model: "test/b", tools: [] },
			{ role: "panel", subagent: "fusion_panel", model: "test/c", tools: [] },
			{ role: "judge", subagent: "fusion_judge", model: "test/judge", tools: [] },
		],
		models: { members: ["test/a", "test/b", "test/c"], synthesis: "test/judge" },
		limits: { maxLoops: 3 },
		source: "builtin",
		path: "fusion-analysis-test.md",
	};
}

function fakeCtx() {
	return {
		cwd: process.cwd(),
		ui: { setStatus() {} },
		modelRegistry: {
			getAvailable: () => [
				{ provider: "test", id: "a", input: ["text"] },
				{ provider: "test", id: "b", input: ["text"] },
				{ provider: "test", id: "c", input: ["text"] },
				{ provider: "test", id: "judge", input: ["text"] },
			],
		},
	};
}

async function runFusionAnalysis(team = fusionAnalysisTeam()) {
	calls.length = 0;
	const stateManager = new TeamStateManager({ appendEntry() {} });
	const runId = stateManager.startRun({ teamId: team.id, protocol: "fusion-analysis", prompt: "test prompt" });
	const handler = getTeamHandler(team);
	if (!handler) throw new Error("fusion-analysis handler missing");
	return handler.run({
		team,
		params: { id: team.id, prompt: "test prompt" },
		ctx: fakeCtx() as never,
		stateManager,
		runId,
		signal: new AbortController().signal,
	});
}

describe("fusion-analysis planner", () => {
	it("keeps configured order, filters invisible models, applies caps, and warns", () => {
		const plan = planFusion({
			configuredPanel: ["test/a", "test/missing", "other/c", "test/b", "test/c"],
			configuredJudge: "test/judge",
			configuredFallback: [],
			visibleModels: ["test/a", "test/b", "test/c", "test/judge"],
			maxPanelModels: 2,
			denyProviders: ["other"],
		});

		expect(plan.panel).toEqual(["test/a", "test/b"]);
		expect(plan.judge).toBe("test/judge");
		expect(plan.fallback).toEqual([]);
		expect(plan.warnings).toEqual([
			"panel model not visible to pi: test/missing",
			"panel model filtered by provider policy: other/c",
		]);
	});

	it("hard caps panel size at four and gates calls above threshold", () => {
		const plan = planFusion({
			configuredPanel: ["test/a", "test/b", "test/c", "test/d", "test/e"],
			maxPanelModels: 10,
			requireApprovalAboveCalls: 3,
		});

		expect(plan.panel).toHaveLength(4);
		expect(plan.estimatedCalls).toBe(5);
		expect(plan.requiresApproval).toBe(true);
	});
});

describe("fusion-analysis handler", () => {
	it("runs bounded panel and judge, skipping synthesis", async () => {
		responses.clear();
		const result = await runFusionAnalysis();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge"]);
		expect(result.details).toMatchObject({ analysis: true, degraded: false });
		expect(result.content.map((entry) => entry.text).join("")).toContain("consensus");
	});

	it("fails when all panel models fail", async () => {
		responses.clear();
		responses.set("panel_1", { ok: false, output: "", error: "fail" });
		responses.set("panel_2", { ok: false, output: "", error: "fail" });
		responses.set("panel_3", { ok: false, output: "", error: "fail" });
		const result = await runFusionAnalysis();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3"]);
		expect(result.details).toMatchObject({ ok: false, failureReason: "all_panels_failed" });
	});

	it("returns structured fallback JSON when judge returns invalid JSON", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: "not json" });
		const result = await runFusionAnalysis();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge"]);
		expect(result.details).toMatchObject({ analysis: true, degraded: true, failureReason: "invalid_judge_json" });
		expect(result.content.map((entry) => entry.text).join("")).toContain("judge returned invalid JSON");
	});
});
