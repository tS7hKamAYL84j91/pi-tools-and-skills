import { describe, expect, it } from "vitest";
import { applyParsedCommand, buildAutoModePrompt, classifyTeamOutcome, estimatedCallDescription, formatTeamModeError, formatTeamModeResult, parseTeamModeArgs } from "../../extensions/pi-panopticon/teams/team-session-mode.js";

describe("team session mode", () => {
	it("parses on/off/status/once with topology and fanout caps", () => {
		expect(parseTeamModeArgs("on --topology llm-council --max-models 3")).toEqual({
			action: "on",
			topology: "llm-council",
			maxModels: 3,
		});
		expect(parseTeamModeArgs("auto --topology navigator")).toEqual({ action: "auto", topology: "navigator" });
		expect(parseTeamModeArgs("once --topology navigator")).toEqual({ action: "once", topology: "navigator" });
		expect(parseTeamModeArgs("off")).toEqual({ action: "off" });
		expect(parseTeamModeArgs("")).toEqual({ action: "status" });
	});

	it("rejects unsafe fanout and unknown topology", () => {
		expect(() => parseTeamModeArgs("on --max-models 6")).toThrow(/1 to 5/);
		expect(() => parseTeamModeArgs("on --topology unknown")).toThrow(/fusion-analysis/);
	});

	it("parses inline prompt for once", () => {
		expect(parseTeamModeArgs("once Should we refactor this?")).toEqual({
			action: "once",
			prompt: "Should we refactor this?",
		});
	});

	it("parses inline prompt with flags", () => {
		expect(parseTeamModeArgs("once Should we refactor this? --topology navigator")).toEqual({
			action: "once",
			prompt: "Should we refactor this?",
			topology: "navigator",
		});
	});

	it("builds auto-mode prompt", () => {
		const prompt = buildAutoModePrompt("Compare options", {
			state: "auto",
			topology: "fusion-analysis",
			maxModels: 2,
			approved: true,
		});

		expect(prompt).toContain("Team auto mode is enabled");
		expect(prompt).toContain("team_run");
		expect(prompt).toContain("only if the prompt warrants deliberation");
		expect(prompt).toContain("Compare options");
	});

	it("builds deterministic team-on prompt for llm-council", () => {
		const prompt = buildAutoModePrompt("Design this", {
			state: "on",
			topology: "llm-council",
			maxModels: 2,
			approved: true,
		});

		expect(prompt).toContain("team_run");
		expect(prompt).toContain("llm-council");
		expect(prompt).toContain("synthesized answer first");
		expect(prompt).toContain("Design this");
	});
});

describe("applyParsedCommand", () => {
	const base = { state: "off" as const, topology: "fusion-analysis" as const, maxModels: 2, approved: false };

	it("sets mode for on/auto/off/once and leaves status unchanged", () => {
		expect(applyParsedCommand(base, { action: "on" })).toMatchObject({ state: "on" });
		expect(applyParsedCommand(base, { action: "auto" })).toMatchObject({ state: "auto" });
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

	it("stores inline prompt in state", () => {
		expect(applyParsedCommand(base, { action: "once", prompt: "Refactor this?" })).toEqual({
			state: "once",
			topology: "fusion-analysis",
			maxModels: 2,
			approved: false,
			prompt: "Refactor this?",
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

	it("reports panel + judge (analysis only) for fusion-analysis, capped at the override", () => {
		expect(estimatedCallDescription({ state: "on", topology: "fusion-analysis", maxModels: 2, approved: true })).toBe("2 panel + judge (structured analysis; outer model synthesizes answer)");
		expect(estimatedCallDescription({ state: "on", topology: "fusion-analysis", maxModels: 5, approved: true })).toBe("3 panel + judge (structured analysis; outer model synthesizes answer)");
	});
});

describe("classifyTeamOutcome", () => {
	it("is ok when all nodes succeed and nothing degraded", () => {
		expect(classifyTeamOutcome({ nodes: [{ ok: true }, { ok: true }, { ok: true }] })).toEqual({ status: "ok", failedCount: 0 });
	});

	it("is partial when a node failed or degraded", () => {
		expect(classifyTeamOutcome({ nodes: [{ ok: true }, { ok: false }] })).toEqual({ status: "partial", failedCount: 1 });
		expect(classifyTeamOutcome({ degraded: true, nodes: [{ ok: true }] })).toEqual({ status: "partial", failedCount: 0 });
	});

	it("is failed when a failure reason or stop is present", () => {
		expect(classifyTeamOutcome({ failureReason: "all_panels_failed", nodes: [] })).toEqual({ status: "failed", failedCount: 0 });
		expect(classifyTeamOutcome({ stopped: true, nodes: [{ ok: true }] })).toEqual({ status: "failed", failedCount: 0 });
	});
});

describe("formatTeamModeResult / formatTeamModeError", () => {
	it("formats an ok result with calls count and no degraded hint", () => {
		const out = formatTeamModeResult("fusion-analysis", { nodes: [{ ok: true }, { ok: true }] }, "analysis text");
		expect(out).toContain('[Team "fusion-analysis" result — status: ok · calls: 2]');
		expect(out).toContain("analysis text");
		expect(out).not.toContain("Degraded run");
	});

	it("formats a partial result with failed count and degraded hint", () => {
		const out = formatTeamModeResult("fusion-analysis", { degraded: true, nodes: [{ ok: true }, { ok: false }] }, "analysis text");
		expect(out).toContain('status: partial · calls: 2 · failed: 1');
		expect(out).toContain('Ask for "trace" for per-model details.');
	});

	it("formats a failed result", () => {
		const out = formatTeamModeResult("fusion-analysis", { failureReason: "all_panels_failed", nodes: [] }, "");
		expect(out).toContain('status: failed · calls: 0');
	});

	it("formats an error follow-up with fail-closed guidance", () => {
		const out = formatTeamModeError("navigator", new Error("boom"));
		expect(out).toContain('[Team "navigator" failed — team mode bypassed]');
		expect(out).toContain("boom");
		expect(out).toContain("Re-ask your prompt");
	});
});
