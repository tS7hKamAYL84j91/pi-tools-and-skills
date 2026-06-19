import { describe, expect, it } from "vitest";
import { applyParsedCommand, buildTeamModePrompt, estimatedCallDescription, parseTeamModeArgs } from "../../extensions/pi-panopticon/teams/team-session-mode.js";

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

describe("applyParsedCommand", () => {
	const base = { state: "off" as const, topology: "router-fusion" as const, maxModels: 2, approved: false };

	it("sets mode for on/off/once and leaves status unchanged", () => {
		expect(applyParsedCommand(base, { action: "on" })).toMatchObject({ state: "on" });
		expect(applyParsedCommand(base, { action: "off" })).toMatchObject({ state: "off" });
		expect(applyParsedCommand(base, { action: "once" })).toMatchObject({ state: "once" });
		expect(applyParsedCommand({ ...base, state: "on" }, { action: "status" })).toMatchObject({ state: "on" });
	});

	it("applies topology and maxModels overrides while preserving approved", () => {
		expect(applyParsedCommand(base, { action: "on", topology: "navigator", maxModels: 4 })).toEqual({
			state: "on",
			topology: "navigator",
			maxModels: 4,
			approved: false,
		});
	});

	it("does not mutate input state", () => {
		const input = { ...base };
		applyParsedCommand(input, { action: "on", maxModels: 3 });
		expect(input).toEqual(base);
	});
});

describe("estimatedCallDescription", () => {
	it("reports one call for navigator", () => {
		expect(estimatedCallDescription({ state: "on", topology: "navigator", maxModels: 2, approved: true })).toBe("1 model call (one focused review)");
	});

	it("reports debate shape for llm-council", () => {
		expect(estimatedCallDescription({ state: "on", topology: "llm-council", maxModels: 3, approved: true })).toBe("members + critiques + synthesis (debate; multiple calls)");
	});

	it("reports panel + judge + synthesis for router-fusion, capped at the override", () => {
		expect(estimatedCallDescription({ state: "on", topology: "router-fusion", maxModels: 2, approved: true })).toBe("2 panel + judge + synthesis");
		expect(estimatedCallDescription({ state: "on", topology: "router-fusion", maxModels: 5, approved: true })).toBe("3 panel + judge + synthesis");
	});
});
