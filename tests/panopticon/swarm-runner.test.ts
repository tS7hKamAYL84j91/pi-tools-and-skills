import { describe, expect, it, vi } from "vitest";
import {
	createSwarmWorkerAdapter,
	SwarmRunner,
} from "../../extensions/pi-panopticon/swarm/swarm-runner.js";
import type {
	SwarmPlan,
	SwarmWorkerAdapter,
	SwarmWorkerRequest,
} from "../../extensions/pi-panopticon/swarm/swarm-types.js";

function parallelPlan(count: number): SwarmPlan {
	return {
		swarmId: "swarm-test",
		goal: "parallel test",
		profile: "fast",
		state: "planned",
		tasks: Array.from({ length: count }, (_, index) => ({
			id: `S-swarm-test-${index + 1}`,
			title: `Task ${index + 1}`,
			brief: `Inspect task ${index + 1}`,
			dependencies: [],
			allowedTools: ["read"],
			readOnly: true,
			reviewProfile: "navigator" as const,
			state: "pending" as const,
			artifacts: [],
			repairCycles: 0,
		})),
	};
}

function mockAdapter() {
	const requests: SwarmWorkerRequest[] = [];
	const stop = vi.fn(async () => {});
	const adapter: SwarmWorkerAdapter = {
		spawn(request) {
			requests.push(request);
			return { name: request.name, stop };
		},
	};
	return { adapter, requests, stop };
}

describe("swarm runner", () => {
	it("exposes the production spawn adapter factory", () => {
		expect(createSwarmWorkerAdapter).toBeTypeOf("function");
	});

	it("hard-caps per-swarm claims at three and uses task scope", () => {
		const mock = mockAdapter();
		const runner = new SwarmRunner(mock.adapter);
		const record = runner.start(parallelPlan(5), "/repo", 20);

		expect(record.config.wip).toBe(3);
		expect(record.plan.tasks.filter((task) => task.state === "in_progress")).toHaveLength(3);
		expect(mock.requests).toHaveLength(3);
		expect(mock.requests.every((request) => request.scope === "task")).toBe(true);
		expect(mock.requests.every((request) => request.cwd === "/repo")).toBe(true);
	});

	it("rejects concurrent swarms", () => {
		const mock = mockAdapter();
		const runner = new SwarmRunner(mock.adapter);
		runner.start(parallelPlan(1), "/repo");
		expect(() => runner.start({ ...parallelPlan(1), swarmId: "other" }, "/repo")).toThrow(
			/already active/,
		);
	});

	it("cancels workers and blocks claimed tasks", async () => {
		const mock = mockAdapter();
		const runner = new SwarmRunner(mock.adapter);
		runner.start(parallelPlan(2), "/repo");

		const record = await runner.stop("swarm-test", "operator cancel");

		expect(mock.stop).toHaveBeenCalledTimes(2);
		expect(record.state).toBe("aborted");
		expect(record.stopReason).toBe("operator cancel");
		expect(record.plan.tasks.every((task) => task.state === "blocked")).toBe(true);
	});
});
