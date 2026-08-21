import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import type { TeamAgentBinding, TeamSpec } from "../../extensions/pi-teams/team-types.js";

interface MockNode {
	ok: boolean;
	output: string;
	error?: string;
}

const calls: string[] = [];
const nodeArguments: Array<{ role: string; binding: TeamAgentBinding; model: string; prompt?: string }> = [];
const responses = new Map<string, MockNode>();

function judgeJson(answer = "ok"): string {
	return JSON.stringify({
		answer,
		consensus: [answer],
		contradictions: [],
		partialCoverage: [],
		uniqueInsights: [],
		blindSpots: [],
		confidence: "high",
		missingEvidence: [],
	});
}

vi.mock("../../extensions/pi-teams/team-node-runner.js", async () => {
	const actual = await vi.importActual<typeof import("../../extensions/pi-teams/team-node-runner.js")>("../../extensions/pi-teams/team-node-runner.js");
	return {
		...actual,
		runTeamNode: async (args: { role: string; binding: TeamAgentBinding; model: string; prompt?: string }) => {
			calls.push(args.role);
			nodeArguments.push(args);
			const response = responses.get(args.role) ?? { ok: true, output: args.role === "judge" ? judgeJson() : `output from ${args.role}` };
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

const { getTeamHandler } = await import("../../extensions/pi-teams/team-handlers.js");
const { planFusion, renderJudgePrompt } = await import("../../extensions/pi-teams/team-handler-fusion-analysis.js");

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

async function runFusionAnalysis(team = fusionAnalysisTeam(), overrides: { profile?: "fast" | "balanced" | "thorough"; limits?: { maxLoops?: number } } = {}) {
	calls.length = 0;
	nodeArguments.length = 0;
	const stateManager = new TeamStateManager({ appendEntry() {} });
	const runId = stateManager.startRun({ teamId: team.id, protocol: "fusion-analysis", prompt: "test prompt" });
	const handler = getTeamHandler(team);
	if (!handler) throw new Error("fusion-analysis handler missing");
	return handler.run({
		team,
		params: { id: team.id, prompt: "test prompt", ...overrides },
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

	it("selects provider-diverse Fast panels deterministically", () => {
		const plan = planFusion({
			configuredPanel: ["openai/a", "openai/b", "google/c", "anthropic/d"],
			maxPanelModels: 2,
			profile: "fast",
		});

		expect(plan.panel).toEqual(["openai/a", "google/c"]);
		expect(plan.panelSourceIndexes).toEqual([0, 2]);
	});

	it("bounds the judge prompt while retaining the complete schema instruction", () => {
		const binding: TeamAgentBinding = { role: "panel", subagent: "panel" };
		const prompt = renderJudgePrompt("q".repeat(2_000), [{ role: "panel_1", binding, model: "test/a", ok: true, output: "x".repeat(5_000), durationMs: 1, attempts: 1 }], 1_000, 200);

		expect(prompt.length).toBeLessThanOrEqual(1_000);
		expect(prompt).toContain("answer, consensus, contradictions, partialCoverage, uniqueInsights, blindSpots, confidence, missingEvidence");
		expect(prompt).toContain("[truncated]");
		expect(prompt).not.toContain("x".repeat(201));
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

	it("applies Fast output bounds and preserves explicit legacy maxLoops precedence", async () => {
		responses.clear();
		await runFusionAnalysis(fusionAnalysisTeam(), { profile: "fast" });
		expect(calls).toEqual(["panel_1", "panel_2", "judge"]);
		expect(nodeArguments[0]?.binding.parameters).toMatchObject({ maxTokens: 600 });
		expect(nodeArguments[2]?.binding.parameters).toMatchObject({ maxTokens: 900 });

		await runFusionAnalysis(fusionAnalysisTeam(), { profile: "fast", limits: { maxLoops: 1 } });
		expect(calls).toEqual(["panel_1", "judge"]);
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
		const fallback = JSON.parse(result.content.map((entry) => entry.text).join("")) as Record<string, unknown>;
		expect(fallback.answer).toContain("judge validation failed");
		expect(fallback.blindSpots).toContain("judge returned invalid JSON");
	});

	it("degrades judge JSON that omits required answer/schema fields", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: JSON.stringify({ consensus: ["incomplete"], blindSpots: [] }) });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ degraded: true, failureReason: "invalid_judge_json" });
	});

	it("degrades a judge response with an empty answer", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: judgeJson(" ") });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ degraded: true, failureReason: "invalid_judge_json" });
	});

	it("parses judge JSON wrapped in markdown code fences (T-744 fix)", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: `\`\`\`json\n${judgeJson("panel agrees")}\n\`\`\`` });
		const result = await runFusionAnalysis();

		expect(calls).toEqual(["panel_1", "panel_2", "panel_3", "judge"]);
		expect(result.details).toMatchObject({ analysis: true, degraded: false });
		const output = result.content.map((entry) => entry.text).join("");
		expect(output).toContain("consensus");
		expect(output).not.toContain("```");
	});

	it("parses judge JSON wrapped in fences with language tag (T-744 fix)", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: `\`\`\`\n${judgeJson()}\n\`\`\`` });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ analysis: true, degraded: false });
	});

	it("parses bare JSON without fences (baseline)", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: judgeJson("bare") });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ analysis: true, degraded: false });
		expect(result.content.map((entry) => entry.text).join("")).toContain("bare");
	});

	it("parses fence-wrapped JSON with extra whitespace (T-744 fix)", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: `\n\n\`\`\`json\n  ${judgeJson("whitespace")}  \n\`\`\`\n\n` });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ analysis: true, degraded: false });
	});

	it("parses JSON in fences with prose before and after (T-744 fix)", async () => {
		responses.clear();
		responses.set("judge", { ok: true, output: `Here is the analysis\n\n\`\`\`${judgeJson("prose-wrapped")}\n\`\`\`\nLet me know if you need more.` });
		const result = await runFusionAnalysis();

		expect(result.details).toMatchObject({ analysis: true, degraded: false });
	});
});
