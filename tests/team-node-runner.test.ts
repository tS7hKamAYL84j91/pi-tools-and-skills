import { describe, expect, it } from "vitest";

import { modelForBinding, nodeDetails, participantsFromRuns, type NodeRun } from "../extensions/pi-teams/team-node-runner.js";

describe("team-node-runner pure helpers", () => {
	const node: NodeRun = {
		role: "member_1",
		binding: { role: "member_1", subagent: "member_agent", label: "Member 1" },
		model: "test/model",
		ok: true,
		output: "answer",
		durationMs: 7,
		attempts: 2,
	};

	it("packages node details without prompt bodies", () => {
		expect(nodeDetails([node])).toEqual([
			{ role: "member_1", model: "test/model", ok: true, durationMs: 7, attempts: 2 },
		]);
	});

	it("converts direct node runs to model runs for prompt packaging", () => {
		expect(participantsFromRuns([node])).toEqual([
			{
				member: { label: "Member 1", model: "test/model" },
				prompt: "",
				systemPrompt: "",
				output: "answer",
				durationMs: 7,
				ok: true,
			},
		]);
	});

	it("resolves ordinary binding models from binding then fallback", () => {
		expect(modelForBinding({ role: "member", subagent: "member_agent", model: "test/binding" }, "test/fallback")).toBe("test/binding");
		expect(modelForBinding({ role: "member", subagent: "member_agent" }, "test/fallback")).toBe("test/fallback");
	});

	it("does not fall back to model-backed defaults for live-agent refs", () => {
		expect(modelForBinding({ role: "member", subagent: "agent:missing-peer" }, "test/fallback")).toBe("agent:missing-peer");
	});
});
