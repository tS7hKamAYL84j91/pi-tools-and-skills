import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { TeamStateManager } from "../../extensions/pi-teams/state.js";
import { registerSwarmTools } from "../../extensions/pi-teams/swarm/swarm-tools.js";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

function response(result: unknown): { content: Array<{ text: string }>; details: Record<string, unknown> } {
	if (!result || typeof result !== "object" || !("content" in result) || !("details" in result)) throw new Error("missing tool response");
	return result as { content: Array<{ text: string }>; details: Record<string, unknown> };
}

describe("swarm compatibility progress", () => {
	it("exposes only hierarchical-swarm Teams runs and stops through their state manager", async () => {
		const stateManager = new TeamStateManager();
		stateManager.rehydrateFromSession({ getEntries: () => [] });
		const runId = stateManager.startRun({ teamId: "hierarchical-swarm-default", protocol: "hierarchical-swarm", prompt: "inspect" });
		stateManager.recordPhaseStarted(runId, "tree");
		const tools = new Map<string, RegisteredTool>();
		registerSwarmTools({ registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI, {
			teams: { stateManager, runtime: new RuntimeControlPlane(), run: vi.fn(), runAsync: vi.fn() },
		});
		const status = tools.get("swarm_status");
		const list = tools.get("swarm_list");
		const stop = tools.get("swarm_stop");
		if (!status || !list || !stop) throw new Error("compatibility tools missing");

		expect(response(await status.execute("call", { swarmId: runId })).content[0]?.text).toContain(`${runId} running`);
		expect(response(await list.execute("call", {})).details.runs).toHaveLength(1);
		expect(response(await stop.execute("call", { swarmId: runId, reason: "test" })).content[0]?.text).toContain("stopping");
		expect(stateManager.isStopRequested(runId)).toBe(true);
	});
});
