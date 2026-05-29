import { describe, expect, it } from "vitest";

import {
	parseTeamHandoff,
	resolveHandoffTarget,
	routeTeamHandoffs,
	TeamHandoffRouter,
	type TeamHandoff,
	type TeamHandoffTargetCandidate,
} from "../extensions/pi-teams/handoff.js";
import type { TeamAgentBinding } from "../extensions/pi-teams/team-types.js";

const synthesisBinding: TeamAgentBinding = { role: "synthesis", subagent: "synthesis", model: "test/synthesis" };
const explorerBinding: TeamAgentBinding = { role: "explorer", subagent: "explorer", model: "test/explorer" };

function handoff(overrides: Partial<TeamHandoff> = {}): TeamHandoff {
	return {
		phaseId: "research_loop_1",
		fromNodeId: "verifier_1",
		target: { type: "node", nodeId: "explorer_2" },
		message: "research verifier gaps handed to next explorer pass",
		data: { loop: 1 },
		...overrides,
	};
}

function candidates(): TeamHandoffTargetCandidate[] {
	return [
		{ nodeId: "explorer_2", binding: explorerBinding, model: "test/explorer" },
		{ nodeId: "synthesis", binding: synthesisBinding, model: "test/synthesis" },
	];
}

describe("team handoff boundary", () => {
	it("accepts the current node-target handoff schema", () => {
		expect(parseTeamHandoff(handoff())).toEqual(handoff());
		expect(resolveHandoffTarget(handoff(), candidates())).toMatchObject({ nodeId: "explorer_2" });
	});

	it("rejects malformed and free-form handoff targets", () => {
		expect(() => parseTeamHandoff({ ...handoff(), target: "explorer_2" })).toThrow(/object target/);
		expect(() => parseTeamHandoff({ ...handoff(), target: { type: "agent", name: "peer" } })).toThrow(/allowed target types: node/);
		expect(() => parseTeamHandoff({ ...handoff(), target: { type: "node", nodeId: "../explorer" } })).toThrow(/target.nodeId/);
	});

	it("rejects unknown handoff targets", () => {
		const router = new TeamHandoffRouter(candidates());
		expect(() => router.route(handoff({ target: { type: "node", nodeId: "missing_node" } }))).toThrow(/Unknown handoff target node/);
	});

	it("rejects runtime targets that cannot be resolved to a binding and model", () => {
		const router = new TeamHandoffRouter([{ nodeId: "explorer_2", binding: explorerBinding }]);
		expect(() => router.route(handoff())).toThrow(/not runtime-routable/);
	});

	it("rejects circular handoff routes", () => {
		const router = new TeamHandoffRouter([
			{ nodeId: "node_a", binding: explorerBinding, model: "test/explorer" },
			{ nodeId: "node_b", binding: synthesisBinding, model: "test/synthesis" },
		]);

		expect(() => router.route(handoff({ fromNodeId: "node_a", target: { type: "node", nodeId: "node_a" } }))).toThrow(/Circular handoff/);
		expect(router.route(handoff({ fromNodeId: "node_a", target: { type: "node", nodeId: "node_b" } }))).toMatchObject({ target: { nodeId: "node_b" } });
		expect(() => router.route(handoff({ fromNodeId: "node_b", target: { type: "node", nodeId: "node_a" } }))).toThrow(/Circular handoff/);
	});

	it("keeps valid routes when later handoffs fail", () => {
		const result = routeTeamHandoffs([
			handoff(),
			handoff({ target: { type: "node", nodeId: "missing_node" } }),
		], candidates());

		expect(result.routes).toHaveLength(1);
		expect(result.routes[0]?.target.nodeId).toBe("explorer_2");
		expect(result.errors).toEqual([{ index: 1, message: expect.stringMatching(/Unknown handoff target node/) }]);
	});
});
