import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TEAM_RUN_CUSTOM_TYPE, TeamStateManager } from "../extensions/pi-teams/state.js";
import type { CouncilMember } from "../extensions/pi-teams/types.js";

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

interface CustomEntry {
	type: "custom";
	customType: string;
	data?: unknown;
}

function appendTo(entries: CustomEntry[]) {
	return (customType: string, data?: unknown) => entries.push({ type: "custom", customType, data });
}

function runIdOf(entry: CustomEntry): string {
	const data = entry.data as { runId?: string };
	if (!data.runId) throw new Error("entry has no run id");
	return data.runId;
}

describe("TeamStateManager", () => {
	let dir: string;
	let store: TeamStateManager;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "council-state-"));
		store = new TeamStateManager(dir);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("appends session entries while keeping legacy file persistence", () => {
		const entries: Array<{ customType: string; data?: unknown }> = [];
		const sessionBacked = new TeamStateManager(dir, {
			appendEntry: (customType, data) => entries.push({ customType, data }),
		});

		const record = sessionBacked.create(createArgs());
		sessionBacked.update(record, { status: "generating" });

		expect(entries).toHaveLength(2);
		expect(entries[0]?.customType).toBe("pi-teams:run");
		expect(entries[0]?.data).toMatchObject({ kind: "run_started", runId: record.id });
		expect(entries[1]?.data).toMatchObject({ kind: "phase_started", runId: record.id, phaseId: "generation" });
		expect(sessionBacked.get(record.id)).toMatchObject({ id: record.id, status: "generating" });
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

	it("appends protocol-abstract session events for non-debate runs", () => {
		const entries: CustomEntry[] = [];
		const sessionBacked = new TeamStateManager(dir, {
			appendEntry: appendTo(entries),
		});

		const runId = sessionBacked.startRun({ teamId: "graph-team", protocol: "graph", prompt: "Ship?" });
		sessionBacked.recordPhaseStarted(runId, "graph");
		sessionBacked.recordNodeCompleted(runId, {
			phaseId: "graph",
			nodeId: "qa",
			role: "qa",
			model: "test/qa",
			ok: true,
			durationMs: 12,
			output: "Looks good",
		});
		sessionBacked.recordRunCompleted(runId, 20, "Looks good");

		expect(entries.map((entry) => entry.customType)).toEqual([TEAM_RUN_CUSTOM_TYPE, TEAM_RUN_CUSTOM_TYPE, TEAM_RUN_CUSTOM_TYPE, TEAM_RUN_CUSTOM_TYPE]);
		expect(entries.map((entry) => (entry.data as { kind: string }).kind)).toEqual(["run_started", "phase_started", "node_completed", "run_completed"]);
		expect(entries[0]?.data).toMatchObject({ protocol: "graph", teamId: "graph-team" });
		expect(entries[2]?.data).toMatchObject({ nodeId: "qa", role: "qa", outputSha256: expect.any(String) });
	});

	it("rehydrates the active session branch and clears prior branch state", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager(dir, { appendEntry: appendTo(entries), filePersistence: false });
		const runA = writer.startRun({ teamId: "team-a", protocol: "graph", prompt: "A?" });
		writer.recordRunCompleted(runA, 1, "A done");
		const runB = writer.startRun({ teamId: "team-b", protocol: "graph", prompt: "B?" });
		writer.recordRunCompleted(runB, 1, "B done");
		const branchA = entries.filter((entry) => runIdOf(entry) === runA);
		const branchB = entries.filter((entry) => runIdOf(entry) === runB);

		const reader = new TeamStateManager(dir, { filePersistence: false });
		reader.rehydrateFromSession({ getBranch: () => branchA, getEntries: () => entries });
		expect(reader.list().map((record) => record.team)).toEqual(["team-a"]);
		reader.rehydrateFromSession({ getBranch: () => branchB, getEntries: () => entries });
		expect(reader.list().map((record) => record.team)).toEqual(["team-b"]);
	});

	it("keeps per-run sequence numbers stable across reload", () => {
		const entries: CustomEntry[] = [];
		const sessionBacked = new TeamStateManager(dir, { appendEntry: appendTo(entries), filePersistence: false });
		const runId = sessionBacked.startRun({ teamId: "graph-team", protocol: "graph", prompt: "Ship?" });
		sessionBacked.recordPhaseStarted(runId, "graph");

		sessionBacked.rehydrateFromSession({ getBranch: () => entries });
		sessionBacked.recordNodeCompleted(runId, {
			phaseId: "graph",
			nodeId: "qa",
			role: "qa",
			model: "test/qa",
			ok: true,
			durationMs: 1,
			output: "ok",
		});

		expect(entries.map((entry) => (entry.data as { seq: number }).seq)).toEqual([1, 2, 3]);
	});

	it("bounds persisted node outputs and run summaries", () => {
		const entries: CustomEntry[] = [];
		const sessionBacked = new TeamStateManager(dir, { appendEntry: appendTo(entries), filePersistence: false });
		const runId = sessionBacked.startRun({ teamId: "graph-team", protocol: "graph", prompt: "Ship?" });
		const output = "x".repeat(70_000);
		sessionBacked.recordNodeCompleted(runId, {
			phaseId: "graph",
			nodeId: "qa",
			role: "qa",
			model: "test/qa",
			ok: true,
			durationMs: 1,
			output,
		});
		sessionBacked.recordRunCompleted(runId, 2, output);

		const nodeEvent = entries[1]?.data as { output: string; outputChars: number; outputSha256: string; outputTruncated: boolean };
		const completedEvent = entries[2]?.data as { summary: string };
		expect(nodeEvent.output).toHaveLength(64_000);
		expect(nodeEvent.outputChars).toBe(70_000);
		expect(nodeEvent.outputSha256).toBe(createHash("sha256").update(output).digest("hex"));
		expect(nodeEvent.outputTruncated).toBe(true);
		expect(completedEvent.summary).toHaveLength(64_000);
	});

	it("does not list legacy JSON records after session rehydrate but can read them by id", () => {
		const legacy = store.create(createArgs());
		const sessionBacked = new TeamStateManager(dir, { filePersistence: false });

		sessionBacked.rehydrateFromSession({ getBranch: () => [] });

		expect(sessionBacked.list()).toEqual([]);
		expect(sessionBacked.get(legacy.id)).toMatchObject({ id: legacy.id, team: "test" });
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
