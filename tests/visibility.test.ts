/**
 * Tests for scoped panopticon visibility.
 */

import { describe, expect, it } from "vitest";
import type { AgentRecord } from "../lib/agent-registry.js";
import { canSee, filterAgentList, visibleRecords } from "../extensions/pi-panopticon/visibility.js";

function makeRecord(overrides: Partial<AgentRecord>): AgentRecord {
	return {
		id: "agent",
		name: "agent",
		pid: 123,
		cwd: "/tmp",
		model: "test/model",
		startedAt: 1,
		heartbeat: 2,
		status: "waiting",
		...overrides,
	};
}

describe("canSee", () => {
	it("keeps global agents on legacy all-agent visibility", () => {
		const root = makeRecord({ id: "root", visibility: "global" });
		const unrelated = makeRecord({ id: "other", parentId: "other-root", visibility: "scoped" });

		expect(canSee(root, unrelated)).toBe(true);
	});

	it("lets scoped children see their parent", () => {
		const parent = makeRecord({ id: "parent", visibility: "global" });
		const child = makeRecord({ id: "child", parentId: "parent", visibility: "scoped" });

		expect(canSee(child, parent)).toBe(true);
	});

	it("lets scoped children see siblings under the same parent", () => {
		const child = makeRecord({ id: "child", parentId: "parent", visibility: "scoped" });
		const sibling = makeRecord({ id: "sibling", parentId: "parent", visibility: "scoped" });

		expect(canSee(child, sibling)).toBe(true);
	});

	it("hides unrelated roots and other parents' children from scoped children", () => {
		const child = makeRecord({ id: "child", parentId: "parent", visibility: "scoped" });
		const otherRoot = makeRecord({ id: "other-root", visibility: "global" });
		const cousin = makeRecord({ id: "cousin", parentId: "other-root", visibility: "scoped" });

		expect(canSee(child, otherRoot)).toBe(false);
		expect(canSee(child, cousin)).toBe(false);
	});

	it("lets agents see direct children", () => {
		const parent = makeRecord({ id: "parent", visibility: "scoped", parentId: "grandparent" });
		const child = makeRecord({ id: "child", parentId: "parent", visibility: "scoped" });

		expect(canSee(parent, child)).toBe(true);
	});
});

describe("visibleRecords", () => {
	it("filters records to parent and siblings for scoped children", () => {
		const parent = makeRecord({ id: "parent", name: "parent" });
		const child = makeRecord({ id: "child", name: "child", parentId: "parent", visibility: "scoped" });
		const sibling = makeRecord({ id: "sibling", name: "sibling", parentId: "parent", visibility: "scoped" });
		const unrelated = makeRecord({ id: "unrelated", name: "unrelated" });

		const visible = visibleRecords(child, [parent, child, sibling, unrelated]).map((r) => r.id);

		expect(visible).toEqual(["parent", "child", "sibling"]);
	});
});

describe("filterAgentList", () => {
	it("lets global agents use children mode to hide other parents' children while keeping roots and own children", () => {
		const self = makeRecord({ id: "self", name: "self", visibility: "global" });
		const root = makeRecord({ id: "root", name: "root", visibility: "global" });
		const ownChild = makeRecord({ id: "own-child", name: "own-child", parentId: "self", visibility: "scoped" });
		const otherChild = makeRecord({ id: "other-child", name: "other-child", parentId: "root", visibility: "scoped" });

		const visible = filterAgentList(self, [self, root, ownChild, otherChild], "children").map((r) => r.id);

		expect(visible).toEqual(["self", "root", "own-child"]);
	});

	it("keeps parent-child links visible in roots mode", () => {
		const parent = makeRecord({ id: "parent", name: "parent", visibility: "global" });
		const child = makeRecord({ id: "child", name: "child", parentId: "parent", visibility: "scoped" });
		const grandchild = makeRecord({ id: "grandchild", name: "grandchild", parentId: "child", visibility: "scoped" });
		const sibling = makeRecord({ id: "sibling", name: "sibling", parentId: "parent", visibility: "scoped" });

		const visible = filterAgentList(child, [parent, child, grandchild, sibling], "roots").map((r) => r.id);

		expect(visible).toEqual(["parent", "child", "grandchild"]);
	});
});
