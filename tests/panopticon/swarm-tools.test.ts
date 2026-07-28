import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { SwarmRunner } from "../../extensions/pi-panopticon/swarm/swarm-runner.js";
import { registerSwarmTools } from "../../extensions/pi-panopticon/swarm/swarm-tools.js";
import type { SwarmWorkerAdapter } from "../../extensions/pi-panopticon/swarm/swarm-types.js";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

interface ToolResponse {
	content: Array<{ type: string; text: string }>;
	details: Record<string, unknown>;
}

function asToolResponse(result: unknown): ToolResponse {
	if (
		!result ||
		typeof result !== "object" ||
		!("content" in result) ||
		!("details" in result)
	) {
		throw new Error("missing tool response");
	}
	return result as ToolResponse;
}

describe("swarm_run dry output", () => {
	it("keeps structured dry-run details while presenting the overview", async () => {
		const tools = new Map<string, RegisteredTool>();
		const spawn = vi.fn();
		const adapter: SwarmWorkerAdapter = { spawn };
		const api = {
			registerTool(tool: RegisteredTool) {
				tools.set(tool.name, tool);
			},
		};
		registerSwarmTools(api as unknown as ExtensionAPI, {
			runner: new SwarmRunner(adapter),
			runtime: new RuntimeControlPlane(),
		});
		const runTool = tools.get("swarm_run");
		if (!runTool) throw new Error("swarm_run was not registered");

		const response = asToolResponse(
			await runTool.execute(
				"call",
				{ goal: "inspect API; implement fix", profile: "fast", wip: 2 },
				new AbortController().signal,
				undefined,
				{ cwd: "/repo" },
			),
		);

		expect(response.details).toEqual({
			plan: expect.objectContaining({
				goal: "inspect API; implement fix",
				profile: "fast",
			}),
			dryRun: true,
		});
		expect(response.content[0]?.text).toContain(
			"Swarm dry run; no workers spawned.",
		);
		expect(spawn).not.toHaveBeenCalled();
	});
});
