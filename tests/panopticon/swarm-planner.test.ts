import { describe, expect, it } from "vitest";
import { planSwarm } from "../../extensions/pi-panopticon/swarm/swarm-planner.js";

describe("swarm planner", () => {
	it("returns a deterministic dependency-ordered task tree", () => {
		const goal = "Inspect the API; implement the feature; verify the tests";
		const first = planSwarm(goal);
		const second = planSwarm(goal);

		expect(second).toEqual(first);
		expect(first.state).toBe("planned");
		expect(first.tasks).toHaveLength(3);
		expect(first.tasks[0]?.dependencies).toEqual([]);
		expect(first.tasks[1]?.dependencies).toEqual([first.tasks[0]?.id]);
		expect(first.tasks[0]?.readOnly).toBe(true);
		expect(first.tasks[1]?.readOnly).toBe(false);
	});

	it("caps decomposition at six tasks", () => {
		const plan = planSwarm("one; two; three; four; five; six; seven");
		expect(plan.tasks).toHaveLength(6);
	});

	it("blocks an unplannable goal", () => {
		const plan = planSwarm(" ");
		expect(plan.state).toBe("blocked");
		expect(plan.tasks).toEqual([]);
		expect(plan.blockedReason).toMatch(/too short/);
	});

	it("selects review depth from profile and task risk", () => {
		expect(planSwarm("Update the architecture", "balanced").tasks[0]?.reviewProfile).toBe(
			"architecture",
		);
		expect(planSwarm("Implement safely", "thorough").tasks[0]?.reviewProfile).toBe("stacked");
	});
});
