import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CouncilStateManager } from "../extensions/council/state.js";
import type { CouncilMember } from "../extensions/council/types.js";

const memberA: CouncilMember = { label: "Agent A", model: "openai/gpt-5.5" };
const memberB: CouncilMember = {
	label: "Agent B",
	model: "anthropic/claude-opus-4-6",
};
const chairman: CouncilMember = {
	label: "Chairman",
	model: "google/gemini-2.5-pro",
};

function createArgs() {
	return {
		council: "test",
		prompt: "Should we ship?",
		members: [memberA, memberB],
		chairman,
	};
}

describe("CouncilStateManager", () => {
	let dir: string;
	let store: CouncilStateManager;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "council-state-"));
		store = new CouncilStateManager(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("create() persists a pending record discoverable by id", () => {
		const record = store.create(createArgs());
		expect(record.status).toBe("pending");
		expect(record.orchestratorPid).toBe(process.pid);
		expect(record.generation).toEqual([]);
		expect(record.critiques).toEqual([]);

		const loaded = store.get(record.id);
		expect(loaded).toEqual(record);
	});

	it("update() merges patches and re-persists", () => {
		const initial = store.create(createArgs());
		const generating = store.update(initial, { status: "generating" });
		expect(generating.status).toBe("generating");

		const completed = store.update(generating, {
			status: "completed",
			completedAt: 12345,
		});
		const reloaded = store.get(completed.id);
		expect(reloaded?.status).toBe("completed");
		expect(reloaded?.completedAt).toBe(12345);
	});

	it("list() returns all persisted records", () => {
		const a = store.create(createArgs());
		const b = store.create(createArgs());
		const ids = store
			.list()
			.map((r) => r.id)
			.sort();
		expect(ids).toEqual([a.id, b.id].sort());
	});

	it("remove() deletes the record", () => {
		const record = store.create(createArgs());
		store.remove(record.id);
		expect(store.get(record.id)).toBeUndefined();
	});

	it("findOrphans() returns non-terminal records whose orchestrator is dead", () => {
		const orphan = store.create(createArgs());
		const live = store.create(createArgs());
		const finished = store.create(createArgs());

		// Force orphan to a dead PID; leave 'live' on this process.
		store.update(orphan, { orchestratorPid: 999_999_999 });
		store.update(finished, { status: "completed", completedAt: Date.now() });

		const orphans = store.findOrphans().map((r) => r.id);
		expect(orphans).toContain(orphan.id);
		expect(orphans).not.toContain(live.id);
		expect(orphans).not.toContain(finished.id);
	});

	it("markFailed() flips an orphan to a terminal status", () => {
		const record = store.create(createArgs());
		store.markFailed(record.id, "orchestrator died");
		const reloaded = store.get(record.id);
		expect(reloaded?.status).toBe("failed");
		expect(reloaded?.error).toBe("orchestrator died");
		expect(reloaded?.completedAt).toBeDefined();
	});

	it("create() generates unique ids for concurrent records", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 10; i++) ids.add(store.create(createArgs()).id);
		expect(ids.size).toBe(10);
	});
});
