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
const { planFusion } = await import("../../extensions/pi-panopticon/teams/team-handler-fusion.js");

function fusionTeam(): TeamSpec {
	return {
		schemaVersion: 2,
		id: "router-fusion-test",
		name: "Router Fusion Test",
		protocol: "fusion",
		prompts: {},
		agents: ["fusion_panel", "fusion_judge", "fusion_synthesis"],
		agentBindings: [
			{ role: "panel", subagent: "fusion_panel", model: "test/a", tools: [] },
			{ role: "panel", subagent: "fusion_panel", model: "test/b", tools: [] },
			{ role: "panel", subagent: "fusion_panel", model: "test/c", tools: [] },
			{ role: "judge", subagent: "fusion_judge", model: "test/judge", tools: [] },
			{ role: "synthesis", subagent: "fusion_synthesis", model: "test/judge", tools: [] },
			{ role: "fallback", subagent: "fusion_panel", model: "test/fallback", tools: [] },
		],
		models: { members: ["test/a", "test/b", "test/c"], synthesis: "test/judge", driver: "test/fallback" },
		limits: { maxLoops: 3 },
		source: "builtin",
		path: "router-fusion-test.md",
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
				{ provider: "test", id: "fallback", input: ["text"] },
			],
		},
	};
}

async function runFusion(team = fusionTeam()) {
	calls.length = 0;
	const stateManager = new TeamStateManager({ appendEntry() {} });
	const runId = stateManager.startRun({ teamId: team.id, protocol: "fusion", prompt: "test prompt" });
	const handler = getTeamHandler(team);
	if (!handler) throw new Error("fusion handler missing");
	return handler.run({
		team,
		params: { id: team.id, prompt: "test prompt" },
		ctx: fakeCtx() as never,
		stateManager,
		runId,
		signal: new AbortController().signal,
	});
}

describe("fusion planner", () => {
	it("keeps configured order, filters invisible models, applies caps, and warns", () => {
		const plan = planFusion({
			configuredPanel: ["test/a", "test/missing", "other/c", "test/b", "test/c"],
			configuredJudge: "test/judge",
			configuredFallback: ["test/fallback"],
			visibleModels: ["test/a", "test/b", "test/c", "test/judge", "test/fallback"],
			maxPanelModels: 2,
			denyProviders: ["other"],
		});

		expect(plan.panel).toEqual(["test/a", "test/b"]);
		expect(plan.judge).toBe("test/judge");
		expect(plan.fallback).toEqual(["test/fallback"]);
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

describe("fusion handler", () => {
	it("runs bounded panel, judge, and synthesis", async () => {
		responses.clear();
		const result = await runFusion();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge", "synthesis"]);
		expect(result.details).toMatchObject({ degraded: false });
	});

	it("continues with partial panel success", async () => {
		responses.clear();
		responses.set("panel_2", { ok: false, output: "", error: "rate_limited" });
		const team = fusionTeam();
		const result = await runFusion(team);

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge", "synthesis"]);
		expect(result.details).toMatchObject({ degraded: true });
	});

	it("tries sequential fallback when all panel models fail", async () => {
		responses.clear();
		responses.set("panel_1", { ok: false, output: "", error: "fail" });
		responses.set("panel_2", { ok: false, output: "", error: "fail" });
		responses.set("panel_3", { ok: false, output: "", error: "fail" });
		const result = await runFusion();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "fallback_1", "judge", "synthesis"]);
		expect(result.details).toMatchObject({ degraded: true });
	});

	it("degrades when judge returns invalid JSON", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: "not json" });
		const result = await runFusion();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge", "synthesis"]);
		expect(result.details).toMatchObject({ degraded: true });
	});
});
