import { describe, expect, it } from "vitest";
import { canSpawn, childCapacity, rootCapacity } from "../../extensions/pi-teams/hierarchical-swarm/capacity.js";
import { parseChildRequests } from "../../extensions/pi-teams/hierarchical-swarm/protocol.js";

const bounds = {
	maxDepth: 2,
	maxChildrenPerNode: 2,
	maxTotalNodes: 5,
	maxWip: 2,
	maxRepairCycles: 1,
	ttlMs: 100,
	writeIsolation: { mode: "tree-global-exclusive" as const },
};

describe("hierarchical swarm protocol", () => {
	it("accepts only one exact fenced JSON child envelope", () => {
		expect(parseChildRequests("```json\n{\"children\":[{\"role\":\"worker\",\"prompt\":\"inspect\"}]}\n```")).toEqual([
		{ role: "worker", prompt: "inspect" },
	]);
		for (const malformed of [
			"text\n```json\n{\"children\":[]}\n```",
			"```json\n{\"children\":[{\"role\":\"root\",\"prompt\":\"no\"}]}\n```",
			"```json\n{\"children\":[{\"role\":\"worker\",\"prompt\":\"x\",\"extra\":true}]}\n```",
		]) {
			expect(parseChildRequests(malformed)).toEqual([]);
		}
	});

	it("inherits configured budgets and leaves omitted limits unbounded", () => {
		const root = rootCapacity(bounds, 1_000);
		expect(root).toMatchObject({ remainingDepth: 2, remainingChildren: 2, remainingTotalNodes: 4, availableWip: 2, remainingRepairCycles: 1, snapshotAt: 1_000 });
		const manager = childCapacity(root, 3, 1_010, bounds.maxChildrenPerNode);
		expect(manager).toMatchObject({ depth: 1, remainingDepth: 1, remainingChildren: 2, remainingTotalNodes: 3, remainingTtlMs: 90, snapshotAt: 1_010 });
		const worker = childCapacity(manager, 2, 1_025, bounds.maxChildrenPerNode);
		expect(worker).toMatchObject({ depth: 2, remainingTotalNodes: 2, remainingTtlMs: 75, snapshotAt: 1_025 });
		expect(canSpawn(manager, 3)).toBe(true);
		expect(canSpawn(worker, 2)).toBe(false);
		expect(rootCapacity({ writeIsolation: bounds.writeIsolation }, 1_000)).toMatchObject({ depth: 0, snapshotAt: 1_000, writeIsolation: bounds.writeIsolation });
	});
});
