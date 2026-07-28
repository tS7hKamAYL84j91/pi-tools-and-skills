import { describe, expect, it } from "vitest";
import { formatSwarmDryRun } from "../../extensions/pi-panopticon/swarm/swarm-format.js";
import { planSwarm } from "../../extensions/pi-panopticon/swarm/swarm-planner.js";

describe("swarm dry-run overview", () => {
	it("summarizes a dependency-ordered multi-task plan", () => {
		const plan = planSwarm(
			"inspect API; update architecture; verify tests",
			"balanced",
		);
		const overview = formatSwarmDryRun(plan, 9);

		expect(overview).toContain("Swarm dry run; no workers spawned.");
		expect(overview).toContain(
			"Goal: inspect API; update architecture; verify tests",
		);
		expect(overview).toContain("Profile: balanced");
		expect(overview).toContain("WIP: requested 9; effective 3 (max 3).");
		expect(overview).toContain("Plan: 3 task(s), sequential dependency order.");
		expect(overview).toContain("1. ");
		expect(overview).toContain("read-only");
		expect(overview).toContain("write-enabled");
		expect(overview).toContain("depends on: none");
		expect(overview).toContain("review: architecture");
		expect(overview).toContain(
			"Bounds: max 6 tasks; WIP ≤3; max 3 repair cycles; TTL/ceiling enforcement.",
		);
		expect(overview).toContain(
			'Next: rerun with dry_run:false using swarm_run({"goal":"inspect API; update architecture; verify tests","profile":"balanced","wip":9,"dry_run":false})',
		);
	});

	it("reports a blocked plan without task rows", () => {
		const plan = planSwarm(" ");
		const overview = formatSwarmDryRun(plan);

		expect(overview).toContain("Swarm dry run; no workers spawned.");
		expect(overview).toContain(
			"Plan: blocked — Goal is empty or too short to decompose. (0 task(s)).",
		);
		expect(overview).toContain("WIP: requested 3; effective 3 (max 3).");
		expect(overview).toContain(
			'Next: rerun with dry_run:false using swarm_run({"goal":"","profile":"balanced","wip":3,"dry_run":false})',
		);
	});
});
