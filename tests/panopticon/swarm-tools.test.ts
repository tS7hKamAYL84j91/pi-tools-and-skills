import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { ok } from "../../lib/tool-result.js";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import { registerSwarmTools } from "../../extensions/pi-teams/swarm/swarm-tools.js";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

function response(result: unknown): {
	content: Array<{ text: string }>;
	details: Record<string, unknown>;
} {
	if (
		!result ||
		typeof result !== "object" ||
		!("content" in result) ||
		!("details" in result)
	)
		throw new Error("missing tool response");
	return result as {
		content: Array<{ text: string }>;
		details: Record<string, unknown>;
	};
}

describe("swarm Teams compatibility tools", () => {
	it("formats a manifest preflight and delegates execution to hierarchical-swarm-default", async () => {
		const tools = new Map<string, RegisteredTool>();
		const run = vi.fn(
			async () =>
				ok("root result", {
					team: "hierarchical-swarm-default",
					runId: "run-test-1",
				}) as unknown as import("../../extensions/pi-teams/team-run-completion.js").TeamRunToolResult,
		);
		const runAsync = vi.fn(() =>
			ok("started", { team: "hierarchical-swarm-default", async: true }),
		);
		registerSwarmTools(
			{
				registerTool(tool: RegisteredTool) {
					tools.set(tool.name, tool);
				},
			} as unknown as ExtensionAPI,
			{
				teams: {
					stateManager: new TeamStateManager(),
					runtime: new RuntimeControlPlane(),
					run,
					runAsync,
				},
			},
		);
		expect([...tools.keys()].sort()).toEqual(
			["swarm_list", "swarm_status", "swarm_stop", "swarm_run"].sort(),
		);
		const swarmRun = tools.get("swarm_run");
		if (!swarmRun) throw new Error("swarm_run was not registered");

		const rejectedWip = response(
			await swarmRun.execute(
				"call",
				{ goal: "inspect API", wip: 9 },
				new AbortController().signal,
				undefined,
				{ cwd: process.cwd() },
			),
		);
		expect(rejectedWip.content[0]?.text).toContain("wip is unsupported");
		const dry = response(
			await swarmRun.execute(
				"call",
				{ goal: "inspect API", profile: "fast" },
				new AbortController().signal,
				undefined,
				{ cwd: process.cwd() },
			),
		);
		expect(dry.content[0]?.text).toContain(
			"Swarm dry run; no workers spawned.",
		);
		expect(dry.content[0]?.text).toContain(
			"Team: hierarchical-swarm-default (hierarchical-swarm).",
		);
		expect(run).not.toHaveBeenCalled();

		await swarmRun.execute(
			"call",
			{ goal: "inspect API", profile: "fast", dry_run: false },
			new AbortController().signal,
			undefined,
			{ cwd: process.cwd() },
		);
		expect(run).toHaveBeenCalledWith(
			{
				id: "hierarchical-swarm-default",
				prompt: "inspect API",
				profile: "fast",
			},
			expect.objectContaining({ cwd: process.cwd() }),
		);
		const asyncResult = response(
			await swarmRun.execute(
				"call",
				{ goal: "inspect API", profile: "fast", dry_run: false, async: true },
				new AbortController().signal,
				undefined,
				{ cwd: process.cwd() },
			),
		);
		expect(asyncResult.details.async).toBe(true);
		expect(runAsync).toHaveBeenCalledWith(
			{
				id: "hierarchical-swarm-default",
				prompt: "inspect API",
				profile: "fast",
				async: true,
			},
			expect.objectContaining({ cwd: process.cwd() }),
		);
	});
});
