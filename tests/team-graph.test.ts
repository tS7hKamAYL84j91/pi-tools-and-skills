import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { runTeamGraph, validateTeamGraph } from "../extensions/pi-teams/team-graph.js";
import type { TeamSpec } from "../extensions/pi-teams/team-types.js";
import type { ModelRun } from "../extensions/pi-teams/types.js";

function team(overrides: Partial<TeamSpec> = {}): TeamSpec {
	return {
		schemaVersion: 2,
		id: "graph-test",
		name: "Graph Test",
		protocol: "graph",
		prompts: {},
		agents: ["graph_agent"],
		agentBindings: [
			{ role: "plan", subagent: "graph_agent", model: "test/plan", subagentSystemPrompt: "plan system" },
			{ role: "review", subagent: "graph_agent", model: "test/review", subagentSystemPrompt: "review system" },
			{ role: "qa", subagent: "graph_agent", model: "test/qa", subagentSystemPrompt: "qa system" },
		],
		graph: { edges: [{ from: "plan", to: "review" }, { from: "plan", to: "qa" }] },
		models: {},
		limits: {},
		source: "builtin",
		path: "graph-test.md",
		...overrides,
	};
}

function fakeCtx(signal?: AbortSignal): ExtensionContext {
	return {
		cwd: process.cwd(),
		signal,
		ui: { setStatus: () => undefined },
	} as unknown as ExtensionContext;
}

describe("team graph validation", () => {
	it("accepts a connected DAG and derives deterministic levels", () => {
		expect(validateTeamGraph(team())).toMatchObject({
			roles: ["plan", "review", "qa"],
			roots: ["plan"],
			sinks: ["review", "qa"],
			levels: [["plan"], ["review", "qa"]],
		});
	});

	it("rejects duplicate roles", () => {
		const invalid = team({
			agentBindings: [
				{ role: "plan", subagent: "graph_agent", model: "test/a" },
				{ role: "plan", subagent: "graph_agent", model: "test/b" },
			],
			graph: { edges: [] },
		});
		expect(() => validateTeamGraph(invalid)).toThrow(/duplicate role/);
	});

	it("rejects missing edge endpoints and cycles before execution", () => {
		expect(() => validateTeamGraph(team({ graph: { edges: [{ from: "missing", to: "qa" }] } }))).toThrow(/unknown from role/);
		expect(() => validateTeamGraph(team({ graph: { edges: [{ from: "plan", to: "review" }, { from: "review", to: "qa" }, { from: "qa", to: "plan" }] } }))).toThrow(/cycle/);
	});
});

describe("team graph execution", () => {
	it("runs fanout nodes concurrently and reduces output in role order", async () => {
		let active = 0;
		let maxActive = 0;
		const calls: string[] = [];
		const result = await runTeamGraph({
			team: team(),
			prompt: "ship?",
			ctx: fakeCtx(),
			maxConcurrency: 2,
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				calls.push(binding.role);
				await new Promise((resolve) => setTimeout(resolve, binding.role === "review" ? 20 : 1));
				active -= 1;
				return {
					member: { label: binding.role, model },
					prompt,
					systemPrompt,
					output: `output:${binding.role}`,
					durationMs: 1,
					ok: true,
				};
			},
		});

		expect(calls[0]).toBe("plan");
		expect(new Set(calls.slice(1))).toEqual(new Set(["review", "qa"]));
		expect(maxActive).toBe(2);
		expect(result.ok).toBe(true);
		expect(result.output).toBe("## review\noutput:review\n\n## qa\noutput:qa");
	});

	it("skips dependents after failed upstream by default", async () => {
		const result = await runTeamGraph({
			team: team({ graph: { edges: [{ from: "plan", to: "review" }, { from: "review", to: "qa" }] } }),
			prompt: "ship?",
			ctx: fakeCtx(),
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => ({
				member: { label: binding.role, model },
				prompt,
				systemPrompt,
				output: binding.role === "plan" ? "bad" : "unexpected",
				durationMs: 1,
				ok: binding.role !== "plan",
				...(binding.role === "plan" ? { error: "failed" } : {}),
			}),
		});

		expect(result.ok).toBe(false);
		expect(result.nodes.map((node) => [node.role, node.status])).toEqual([
			["plan", "failed"],
			["review", "skipped"],
			["qa", "skipped"],
		]);
	});
});
