import { describe, expect, it, vi } from "vitest";
import { runSwarmGates } from "../../extensions/pi-panopticon/swarm/swarm-gates.js";
import type {
	SwarmReviewAdapter,
	SwarmTask,
} from "../../extensions/pi-panopticon/swarm/swarm-types.js";

function task(profile: SwarmTask["reviewProfile"]): SwarmTask {
	return {
		id: "S-swarm-1",
		title: "Implement change",
		brief: "Implement change",
		dependencies: [],
		allowedTools: ["edit"],
		readOnly: false,
		reviewProfile: profile,
		state: "in_progress",
		artifacts: [],
		repairCycles: 0,
	};
}

function passingReviewer() {
	const review = vi.fn(async (teamId: string) => ({
		teamId,
		verdict: "pass" as const,
		summary: "passed",
	}));
	const adapter: SwarmReviewAdapter = { review };
	return { adapter, review };
}

describe("swarm artifact gates", () => {
	it("blocks DONE without checkable artifact evidence", async () => {
		const reviewer = passingReviewer();
		const result = await runSwarmGates(task("navigator"), reviewer.adapter);
		expect(result.verdict).toBe("blocked");
		expect(reviewer.review).not.toHaveBeenCalled();
	});

	it("runs the configured stacked reviews in order", async () => {
		const reviewer = passingReviewer();
		const candidate = task("stacked");
		candidate.artifacts = [{ path: "src/change.ts", evidence: "npm test passed" }];
		const result = await runSwarmGates(candidate, reviewer.adapter);
		expect(result.verdict).toBe("pass");
		expect(reviewer.review.mock.calls.map(([teamId]) => teamId)).toEqual([
			"navigator",
			"llm-council",
			"fire-review",
		]);
	});
});
