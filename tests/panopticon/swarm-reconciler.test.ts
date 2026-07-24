import { describe, expect, it } from "vitest";
import { formatCompletionSignal } from "../../lib/completion-signal.js";
import { reconcileCompletion } from "../../extensions/pi-panopticon/swarm/swarm-reconciler.js";
import type {
	SwarmPlan,
	SwarmReviewAdapter,
} from "../../extensions/pi-panopticon/swarm/swarm-types.js";

function plan(): SwarmPlan {
	return {
		swarmId: "swarm-test",
		goal: "test",
		profile: "fast",
		state: "planned",
		tasks: [{
			id: "S-swarm-test-1",
			title: "Test",
			brief: "Test",
			dependencies: [],
			allowedTools: ["read"],
			readOnly: true,
			reviewProfile: "navigator",
			state: "in_progress",
			artifacts: [],
			repairCycles: 0,
		}],
	};
}

function signal(status: "done" | "blocked") {
	return formatCompletionSignal({
		version: 1,
		taskId: "S-swarm-test-1",
		status,
		summary: status,
		artifacts: ["result.txt"],
	});
}

const passingReviewer: SwarmReviewAdapter = {
	async review(teamId) {
		return { teamId, verdict: "pass", summary: "passed" };
	},
};

describe("swarm reconciler", () => {
	it("accepts DONE only after artifact and review gates", async () => {
		const candidate = plan();
		const result = await reconcileCompletion(
			candidate,
			signal("done"),
			[{ command: "npm test", evidence: "993 tests passed" }],
			passingReviewer,
		);
		expect(result.gate?.verdict).toBe("pass");
		expect(candidate.tasks[0]?.state).toBe("done");
	});

	it("blocks explicit worker failure without retry", async () => {
		const candidate = plan();
		await reconcileCompletion(candidate, signal("blocked"), [], passingReviewer);
		expect(candidate.tasks[0]?.state).toBe("blocked");
	});

	it("rejects stale provenance on a repair", async () => {
		const candidate = plan();
		const task = candidate.tasks[0];
		if (!task) throw new Error("missing fixture task");
		task.lastEvidence = JSON.stringify([{
			path: "result.txt",
			evidence: "old",
		}]);
		const result = await reconcileCompletion(
			candidate,
			signal("done"),
			[{ path: "result.txt", evidence: "old" }],
			passingReviewer,
		);
		expect(result.reason).toMatch(/stale/);
		expect(task.state).toBe("blocked");
	});
});
