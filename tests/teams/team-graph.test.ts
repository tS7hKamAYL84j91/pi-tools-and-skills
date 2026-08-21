import { describe, expect, it } from "vitest";

import { getTeamHandler, modelSlotsForTeam, promptChainsForTeam } from "../../extensions/pi-teams/team-handlers.js";
import type { TeamSpec } from "../../extensions/pi-teams/team-types.js";

function team(overrides: Partial<TeamSpec> = {}): TeamSpec {
	return {
		schemaVersion: 2,
		id: "direct-test",
		name: "Direct Test",
		protocol: "debate",
		prompts: {},
		agents: ["member_agent", "critic_agent", "synthesis_agent"],
		agentBindings: [
			{ role: "member", subagent: "member_agent", model: "test/a", label: "Alpha" },
			{ role: "member", subagent: "member_agent", model: "test/b", label: "Beta" },
			{ role: "critic", subagent: "critic_agent" },
			{ role: "synthesis", subagent: "synthesis_agent", model: "test/synthesis" },
		],
		models: { members: ["test/a", "test/b"], synthesis: "test/synthesis" },
		limits: {},
		source: "builtin",
		path: "direct-test.md",
		...overrides,
	};
}

describe("direct team handlers", () => {
	it("routes built-in protocols to direct handlers and rejects graph", () => {
		expect(getTeamHandler(team({ protocol: "consult", models: { navigator: "test/nav" } }))?.key).toBe("council");
		expect(getTeamHandler(team({ protocol: "debate" }))?.key).toBe("council");
		expect(getTeamHandler(team({ protocol: "council" }))?.key).toBe("council");
		expect(getTeamHandler(team({ protocol: "research" }))?.key).toBe("research");
		expect(getTeamHandler(team({ protocol: "telephone" }))).toBeUndefined();
		expect(modelSlotsForTeam(team({ protocol: "telephone" }), team().models)).toEqual([]);
		expect(promptChainsForTeam(team({ protocol: "telephone" }))).toEqual([]);
		expect(getTeamHandler(team({ protocol: "graph" }))).toBeUndefined();
	});

	it("reports debate, consult, and research model slots without graph lowering", () => {
		expect(modelSlotsForTeam(team(), team().models)).toEqual([
			{ id: "member:0", label: "Member model 1", current: "test/a", kind: "member", index: 0 },
			{ id: "member:1", label: "Member model 2", current: "test/b", kind: "member", index: 1 },
			{ id: "synthesis", label: "Synthesis model", current: "test/synthesis", kind: "synthesis" },
		]);
		expect(modelSlotsForTeam(team({ protocol: "consult", models: { navigator: "test/nav" } }), { navigator: "test/nav" })).toEqual([
			{ id: "navigator", label: "Navigator model", current: "test/nav", kind: "navigator" },
		]);
		expect(modelSlotsForTeam(team({ protocol: "research" }), team().models)).toEqual([
			{ id: "explorer", label: "Explorer model", current: "test/a", kind: "member", index: 0 },
			{ id: "verifier", label: "Verifier model", current: "test/b", kind: "member", index: 1 },
			{ id: "synthesis", label: "Synthesis model", current: "test/synthesis", kind: "synthesis" },
		]);
	});

	it("declares protocol prompt chains from handlers", () => {
		expect(promptChainsForTeam(team()).map((chain) => chain.slot)).toEqual([
			"generation.system",
			"critique.system",
			"critique.template",
			"synthesis.system",
			"synthesis.template",
		]);
		expect(promptChainsForTeam(team({ protocol: "consult", models: { navigator: "test/nav" } })).map((chain) => chain.slot)).toEqual([
			"navigator.system",
			"navigator.template",
		]);
	});
});
