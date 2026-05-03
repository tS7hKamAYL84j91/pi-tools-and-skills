import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { resolveTeamSettings } from "../extensions/pi-teams/settings.js";
import { graphPlanForSimpleProtocol } from "../extensions/pi-teams/team-handlers.js";
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

const settings = resolveTeamSettings("/nonexistent/pi-settings.json");

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

	it("lowers debate to generation, critique, and synthesis graph nodes", async () => {
		const debateTeam = team({
			id: "debate-test",
			protocol: "debate",
			agents: ["member_agent", "critic_agent", "chair_agent"],
			agentBindings: [
				{ role: "member", subagent: "member_agent", model: "test/a", label: "Alpha" },
				{ role: "member", subagent: "member_agent", model: "test/b", label: "Beta" },
				{ role: "critic", subagent: "critic_agent" },
				{ role: "chairman", subagent: "chair_agent", model: "test/chair" },
			],
			graph: undefined,
			models: { members: ["test/a", "test/b"], chairman: "test/chair" },
		});
		const plan = graphPlanForSimpleProtocol({ team: debateTeam, params: { id: "debate-test", prompt: "ship?" }, settings });
		if (!plan) throw new Error("missing debate graph plan");
		const prompts = new Map<string, string>();
		const result = await runTeamGraph({
			team: plan.team,
			prompt: "ship?",
			ctx: fakeCtx(),
			buildNodePrompt: plan.buildNodePrompt,
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => {
				prompts.set(binding.role, prompt);
				return { member: { label: binding.label ?? binding.role, model }, prompt, systemPrompt, output: `output:${binding.role}`, durationMs: 1, ok: true };
			},
		});

		expect(plan.team.graph?.outputs).toEqual(["synthesis"]);
		expect(plan.team.agentBindings.map((binding) => binding.role)).toEqual(["generation_1", "generation_2", "critique_1", "critique_2", "synthesis"]);
		expect(prompts.get("generation_1")).toBe("ship?");
		expect(prompts.get("critique_1")).toContain("## Beta");
		expect(prompts.get("critique_1")).not.toContain("## Alpha");
		expect(prompts.get("synthesis")).toContain("Raw council answers:");
		expect(prompts.get("synthesis")).toContain("## Critique by Alpha");
		expect(result.output).toBe("## synthesis\noutput:synthesis");
	});

	it("lowers pair-coding to an unrolled review and fix graph", async () => {
		const pairTeam = team({
			id: "pair-test",
			protocol: "pair-coding",
			agents: ["navigator_agent", "driver_agent"],
			agentBindings: [
				{ role: "navigator_brief", subagent: "navigator_agent", model: "test/nav" },
				{ role: "driver_implementation", subagent: "driver_agent", model: "test/driver" },
				{ role: "navigator_review", subagent: "navigator_agent", model: "test/nav" },
				{ role: "driver_fix", subagent: "driver_agent", model: "test/driver" },
			],
			graph: undefined,
			models: { driver: "test/driver", navigator: "test/nav" },
			limits: { maxFixPasses: 1 },
		});
		const plan = graphPlanForSimpleProtocol({ team: pairTeam, params: { id: "pair-test", prompt: "change x" }, settings });
		if (!plan) throw new Error("missing pair graph plan");
		const prompts = new Map<string, string>();
		const result = await runTeamGraph({
			team: plan.team,
			prompt: "change x",
			ctx: fakeCtx(),
			buildNodePrompt: plan.buildNodePrompt,
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => {
				prompts.set(binding.role, prompt);
				return { member: { label: binding.role, model }, prompt, systemPrompt, output: `output:${binding.role}`, durationMs: 1, ok: true };
			},
		});

		expect(plan.team.graph).toEqual({
			edges: [
				{ from: "navigator_brief", to: "driver_implementation" },
				{ from: "driver_implementation", to: "navigator_review_1" },
				{ from: "navigator_review_1", to: "driver_fix_1" },
			],
			outputs: ["driver_fix_1"],
		});
		expect(prompts.get("driver_implementation")).toContain("output:navigator_brief");
		expect(prompts.get("navigator_review_1")).toContain("output:driver_implementation");
		expect(prompts.get("driver_fix_1")).toContain("output:navigator_review_1");
		expect(result.output).toBe("## driver_fix_1\noutput:driver_fix_1");
	});

	it("lowers consult to one graph node with the consult prompt contract", async () => {
		const consultTeam = team({
			id: "consult-test",
			protocol: "consult",
			agents: ["navigator_agent"],
			agentBindings: [{ role: "navigator", subagent: "navigator_agent", model: "test/nav", subagentPromptId: "consult/navigator/system", subagentSystemPrompt: "wrong" }],
			graph: undefined,
			models: { navigator: "test/nav" },
		});
		const plan = graphPlanForSimpleProtocol({ team: consultTeam, params: { id: "consult-test", prompt: "review this" }, settings });
		if (!plan) throw new Error("missing consult graph plan");
		const seen: string[] = [];
		const result = await runTeamGraph({
			team: plan.team,
			prompt: "review this",
			ctx: fakeCtx(),
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => {
				seen.push(prompt, systemPrompt);
				return { member: { label: binding.role, model }, prompt, systemPrompt, output: "consulted", durationMs: 1, ok: true };
			},
		});

		expect(plan.team.graph).toEqual({ edges: [], outputs: ["navigator"] });
		expect(result.output).toBe("## navigator\nconsulted");
		expect(seen[0]).toBe("review this");
		expect(seen[1]).toContain("Navigator in a pair-coding session");
	});

	it("lowers telephone to a linear graph that passes each output to the next relay", async () => {
		const telephoneTeam = team({
			id: "telephone-test",
			protocol: "telephone",
			agents: ["relay_agent"],
			agentBindings: [
				{ role: "relay_1", subagent: "relay_agent", model: "test/one" },
				{ role: "relay_2", subagent: "relay_agent", model: "test/two" },
			],
			graph: undefined,
			models: { members: ["test/one", "test/two"] },
		});
		const plan = graphPlanForSimpleProtocol({ team: telephoneTeam, params: { id: "telephone-test", prompt: "hello" }, settings });
		if (!plan) throw new Error("missing telephone graph plan");
		const prompts: string[] = [];
		const systems: string[] = [];
		const result = await runTeamGraph({
			team: plan.team,
			prompt: "hello",
			ctx: fakeCtx(),
			templateSlot: plan.templateSlot,
			buildNodePrompt: plan.buildNodePrompt,
			runNode: async ({ binding, model, prompt, systemPrompt }): Promise<ModelRun> => {
				prompts.push(prompt);
				systems.push(systemPrompt);
				return { member: { label: binding.role, model }, prompt, systemPrompt, output: `output:${binding.role}`, durationMs: 1, ok: true };
			},
		});

		expect(plan.team.graph).toEqual({ edges: [{ from: "relay_1", to: "relay_2" }], outputs: ["relay_2"] });
		expect(prompts[0]).toContain("hello");
		expect(prompts[1]).toContain("output:relay_1");
		expect(systems[0]).toContain("relay 1 of 2");
		expect(systems[1]).toContain("relay 2 of 2");
		expect(result.output).toBe("## relay_2\noutput:relay_2");
	});
});
