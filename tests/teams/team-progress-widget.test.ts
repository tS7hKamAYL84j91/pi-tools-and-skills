import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import type { TeamSpec } from "../../extensions/pi-teams/team-types.js";

const TEAM: TeamSpec = {
	schemaVersion: 2,
	id: "widget-test",
	name: "Widget test",
	protocol: "consult",
	prompts: {},
	agents: [],
	agentBindings: [],
	models: {},
	limits: {},
	source: "project",
	path: "/tmp/widget-test.md",
};

vi.mock("../../extensions/pi-teams/team-registry.js", () => ({
	loadTeamRegistry: () => ({ teams: new Map([[TEAM.id, TEAM]]), subagents: new Map(), warnings: [] }),
}));

vi.mock("../../extensions/pi-teams/team-handlers.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../extensions/pi-teams/team-handlers.js")>();
	return {
		...actual,
		getTeamHandler: () => ({
			run: async (args: { stateManager: TeamStateManager; runId: string }) => {
				args.stateManager.recordPhaseStarted(args.runId, "consult");
				args.stateManager.recordNodeStarted(args.runId, { phaseId: "consult", nodeId: "one", role: "navigator", model: "test/one" });
				args.stateManager.recordNodeStarted(args.runId, { phaseId: "consult", nodeId: "two", role: "critic", model: "test/two" });
				args.stateManager.recordNodeCompleted(args.runId, { phaseId: "consult", nodeId: "one", role: "navigator", model: "test/one", ok: true, durationMs: 5, output: "one" });
				args.stateManager.recordNodeCompleted(args.runId, { phaseId: "consult", nodeId: "two", role: "critic", model: "test/two", ok: true, durationMs: 6, output: "two" });
				return { content: [{ type: "text" as const, text: "done" }], details: {} };
			},
		}),
	};
});

const { runTeam } = await import("../../extensions/pi-teams/team-runtime.js");

describe("team progress widget", () => {
	it("renders every node on state events with a per-run key and clears it", async () => {
		const widgets: Array<{ key: string; lines: string[] | undefined }> = [];
		const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
		const ctx = {
			cwd: process.cwd(),
			ui: {
				setWidget: (key: string, lines: string[] | undefined) => widgets.push({ key, lines }),
			},
		} as unknown as ExtensionContext;

		await runTeam({
			params: { id: TEAM.id, prompt: "show progress" },
			ctx,
			stateManager: new TeamStateManager(),
		});

		expect(setIntervalSpy).not.toHaveBeenCalled();
		const populated = widgets.filter((widget) => widget.lines !== undefined);
		expect(populated.length).toBeGreaterThan(1);
		expect(new Set(widgets.map((widget) => widget.key)).size).toBe(1);
		expect(widgets[0]?.key).toMatch(/^team:team-/);
		expect(populated.some((widget) => widget.lines?.some((line) => line.includes("navigator (test/one)"))
			&& widget.lines.some((line) => line.includes("critic (test/two)")))).toBe(true);
		expect(populated.at(-1)?.lines).toEqual(expect.arrayContaining([expect.stringMatching(/^cancel: \/teams stop team-/)]));
		expect(widgets.at(-1)).toEqual({ key: widgets[0]?.key, lines: undefined });
		setIntervalSpy.mockRestore();
	});
});
