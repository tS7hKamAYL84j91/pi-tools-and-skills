import { describe, expect, it } from "vitest";
import { buildTeamModePrompt, parseTeamModeArgs } from "../../extensions/pi-panopticon/teams/team-session-mode.js";

describe("team session mode", () => {
	it("parses on/off/status/once with topology and fanout caps", () => {
		expect(parseTeamModeArgs("on --topology llm-council --max-models 3")).toEqual({
			action: "on",
			topology: "llm-council",
			maxModels: 3,
		});
		expect(parseTeamModeArgs("once --topology navigator")).toEqual({ action: "once", topology: "navigator" });
		expect(parseTeamModeArgs("off")).toEqual({ action: "off" });
		expect(parseTeamModeArgs("")).toEqual({ action: "status" });
	});

	it("rejects unsafe fanout and unknown topology", () => {
		expect(() => parseTeamModeArgs("on --max-models 6")).toThrow(/1 to 5/);
		expect(() => parseTeamModeArgs("on --topology unknown")).toThrow(/router-fusion/);
	});

	it("builds synthesis-first prompt without trace-by-default", () => {
		const prompt = buildTeamModePrompt("Design this", {
			state: "on",
			topology: "router-fusion",
			maxModels: 2,
			approved: true,
		});

		expect(prompt).toContain("team_run");
		expect(prompt).toContain("router-fusion");
		expect(prompt).toContain("limits.maxLoops=2");
		expect(prompt).toContain("synthesized answer first");
		expect(prompt).toContain("Only include details if the user explicitly asks");
		expect(prompt).toContain("Design this");
	});
});
