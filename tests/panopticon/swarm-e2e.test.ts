import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RuntimeControlPlane } from "../../lib/runtime-control-plane.js";
import { formatCompletionSignal } from "../../lib/completion-signal.js";
import { reconcileCompletion } from "../../extensions/pi-panopticon/swarm/swarm-reconciler.js";
import { SwarmRunner } from "../../extensions/pi-panopticon/swarm/swarm-runner.js";
import { registerSwarmTools } from "../../extensions/pi-panopticon/swarm/swarm-tools.js";
import type {
	SwarmPlan,
	SwarmReviewAdapter,
	SwarmWorkerAdapter,
} from "../../extensions/pi-panopticon/swarm/swarm-types.js";

interface RegisteredTool {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown>;
}

function resultDetails(result: unknown): Record<string, unknown> {
	if (!result || typeof result !== "object" || !("details" in result)) throw new Error("missing tool details");
	return (result as { details: Record<string, unknown> }).details;
}

describe("swarm end-to-end orchestration", () => {
	it("plans dry, bounds task workers, gates artifacts, and tears down", async () => {
		const tools = new Map<string, RegisteredTool>();
		const stops: Array<ReturnType<typeof vi.fn>> = [];
		const adapter: SwarmWorkerAdapter = {
			spawn(request) {
				const stop = vi.fn(async () => {});
				stops.push(stop);
				expect(request.scope).toBe("task");
				return { name: request.name, stop };
			},
		};
		const runner = new SwarmRunner(adapter);
		const api = {
			registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
		};
		// The fake intentionally implements only the registration surface under test.
		registerSwarmTools(api as unknown as ExtensionAPI, {
			runner,
			runtime: new RuntimeControlPlane(),
		});
		const runTool = tools.get("swarm_run");
		if (!runTool) throw new Error("swarm_run was not registered");
		const dryResult = await runTool.execute(
			"call",
			{ goal: "inspect one; inspect two; inspect three; inspect four", dry_run: true },
			new AbortController().signal,
			undefined,
			{ cwd: "/repo" },
		);
		const plan = resultDetails(dryResult).plan as SwarmPlan;
		expect(resultDetails(dryResult).dryRun).toBe(true);
		expect(stops).toHaveLength(0);

		for (const task of plan.tasks) task.dependencies = [];
		const record = runner.start(plan, "/repo", 9);
		expect(record.plan.tasks.filter((task) => task.state === "in_progress")).toHaveLength(3);

		const first = record.plan.tasks[0];
		if (!first) throw new Error("missing planned task");
		const reviewer: SwarmReviewAdapter = {
			async review(teamId) { return { teamId, verdict: "pass", summary: "passed" }; },
		};
		const signal = formatCompletionSignal({
			version: 1,
			taskId: first.id,
			status: "done",
			summary: "implemented",
			artifacts: ["result.txt"],
		});
		const reconciled = await reconcileCompletion(
			record.plan,
			signal,
			[{ command: "npm test", evidence: "tests passed" }],
			reviewer,
		);
		expect(reconciled.gate?.verdict).toBe("pass");

		await runner.stop(plan.swarmId, "test teardown");
		expect(record.state).toBe("aborted");
		expect(stops.filter((stop) => stop.mock.calls.length > 0)).toHaveLength(2);
	});
});
