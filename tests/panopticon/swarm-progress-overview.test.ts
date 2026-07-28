import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { SwarmRunner } from "../../extensions/pi-panopticon/swarm/swarm-runner.js";
import { registerSwarmTools } from "../../extensions/pi-panopticon/swarm/swarm-tools.js";
import type {
	SwarmPlan,
	SwarmWorkerAdapter,
} from "../../extensions/pi-panopticon/swarm/swarm-types.js";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

interface ToolResponse {
	content: Array<{ type: string; text: string }>;
	details: { records?: unknown[]; record?: unknown };
}

function response(result: unknown): ToolResponse {
	if (!result || typeof result !== "object" || !("content" in result) || !("details" in result)) {
		throw new Error("missing tool response");
	}
	return result as ToolResponse;
}

function plan(swarmId: string, state: "planned" | "blocked" = "planned"): SwarmPlan {
	return {
		swarmId,
		goal: "publish progress overview",
		profile: "balanced",
		state,
		blockedReason: state === "blocked" ? "manual approval required" : undefined,
		tasks: [
			{
				id: "task-1", title: "Inspect", brief: "private task brief", dependencies: [],
				allowedTools: ["read"], readOnly: true, reviewProfile: "navigator",
				state: "pending", artifacts: [], repairCycles: 0,
			},
			{
				id: "task-2", title: "Implement", brief: "private worker prompt", dependencies: ["task-1"],
				allowedTools: ["write"], readOnly: false, reviewProfile: "architecture",
				state: "pending", artifacts: [], repairCycles: 2,
			},
		],
	};
}

function registeredTools(runner: SwarmRunner): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const api = { registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); } };
	registerSwarmTools(api as unknown as ExtensionAPI, {
		runner,
		runtime: new RuntimeControlPlane(),
	});
	return tools;
}

function workerAdapter(): SwarmWorkerAdapter {
	return { spawn: vi.fn((request) => ({ name: request.name, stop: vi.fn(async () => {}) })) };
}

describe("swarm progress overview", () => {
	it("shows running task progress without private brief or artifact evidence", async () => {
		const runner = new SwarmRunner(workerAdapter());
		const record = runner.start(plan("running-swarm"), "/repo", 2);
		const [first, second] = record.plan.tasks;
		if (!first || !second) throw new Error("missing tasks");
		first.state = "done";
		first.artifacts = [{ path: "result.txt", evidence: "secret artifact evidence" }];
		second.state = "in_progress";
		second.workerName = "overview-worker";
		const status = registeredTools(runner).get("swarm_status");
		if (!status) throw new Error("swarm_status was not registered");

		const result = response(await status.execute("call", { swarmId: "running-swarm" }));
		const text = result.content[0]?.text ?? "";

		expect(text).toContain("Swarm running-swarm | state: running");
		expect(text).toContain("Profile: balanced | WIP: 2");
		expect(text).toContain("Tasks: active 1; complete 1; blocked 0; failed 0");
		expect(text).toContain("task-2 | in_progress | dependencies: ready | worker: overview-worker | repairs: 2 | review: architecture | artifacts: 0");
		expect(text).not.toContain("private task brief");
		expect(text).not.toContain("secret artifact evidence");
		expect(result.details.record).toBe(record);
	});

	it("lists terminal and blocked summaries with their reasons", async () => {
		const runner = new SwarmRunner(workerAdapter());
		const blocked = runner.start(plan("blocked-swarm", "blocked"), "/repo");
		const blockedTask = blocked.plan.tasks[0];
		if (!blockedTask) throw new Error("missing blocked task");
		blockedTask.state = "blocked";
		const stopped = runner.start(plan("stopped-swarm"), "/repo");
		await runner.stop("stopped-swarm", "operator cancelled");
		const tools = registeredTools(runner);
		const status = tools.get("swarm_status");
		const list = tools.get("swarm_list");
		if (!status || !list) throw new Error("progress tools were not registered");

		const statusResult = response(await status.execute("call", { swarmId: "blocked-swarm" }));
		const statusText = statusResult.content[0]?.text ?? "";
		const listResult = response(await list.execute("call", {}));
		const listText = listResult.content[0]?.text ?? "";

		expect(statusText).toContain("task-2 | pending | dependencies: waiting");
		expect(statusText).toContain("Reason: manual approval required");
		expect(listText).toContain("Swarm blocked-swarm | blocked");
		expect(listText).toContain("reason: manual approval required");
		expect(listText).toContain("Swarm stopped-swarm | aborted");
		expect(listText).toContain("reason: operator cancelled");
		expect(listResult.details.records).toEqual([blocked, stopped]);
	});
});
