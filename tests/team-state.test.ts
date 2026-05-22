import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { TEAM_RUN_CUSTOM_TYPE, TeamStateManager } from "../extensions/pi-teams/state.js";

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
	it("appends protocol-neutral session events", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });

		const runId = store.startRun({ teamId: "graph-team", protocol: "graph", prompt: "Ship?" });
		store.recordPhaseStarted(runId, "graph");
		store.recordNodeCompleted(runId, {
			phaseId: "graph",
			nodeId: "qa",
			role: "qa",
			model: "test/model",
			ok: true,
			durationMs: 12,
			output: "Looks good",
		});
		store.recordRunCompleted(runId, 20, "Looks good");

		expect(entries.map((entry) => entry.customType)).toEqual([
			TEAM_RUN_CUSTOM_TYPE,
			TEAM_RUN_CUSTOM_TYPE,
			TEAM_RUN_CUSTOM_TYPE,
			TEAM_RUN_CUSTOM_TYPE,
		]);
		expect(entries.map((entry) => (entry.data as { kind: string }).kind)).toEqual([
			"run_started",
			"phase_started",
			"node_completed",
			"run_completed",
		]);
	});

	it("rehydrates only the current session branch", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runA = writer.startRun({ teamId: "team-a", protocol: "graph", prompt: "A?" });
		writer.recordRunCompleted(runA, 1, "A done");
		const runB = writer.startRun({ teamId: "team-b", protocol: "graph", prompt: "B?" });
		writer.recordRunCompleted(runB, 1, "B done");

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries.slice(0, 2) });

		expect(reader.list().map((record) => record.team)).toEqual(["team-a"]);
		expect(reader.get(runB)).toBeUndefined();
	});

	it("records bounded node output with integrity metadata", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "graph-team", protocol: "graph", prompt: "Ship?" });
		const output = "x".repeat(70_000);

		store.recordNodeCompleted(runId, {
			phaseId: "graph",
			nodeId: "huge",
			role: "huge",
			model: "test/model",
			ok: true,
			durationMs: 1,
			output,
		});

		const nodeEvent = entries.find((entry) => (entry.data as { kind?: string }).kind === "node_completed")?.data as {
			output: string;
			outputChars: number;
			outputSha256: string;
			outputTruncated: boolean;
		};
		expect(nodeEvent.output).toHaveLength(64_000);
		expect(nodeEvent.outputChars).toBe(70_000);
		expect(nodeEvent.outputSha256).toBe(createHash("sha256").update(output).digest("hex"));
		expect(nodeEvent.outputTruncated).toBe(true);
	});

	it("records structured run detail events", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });

		writer.recordDetail(runId, {
			kind: "handoff",
			phaseId: "research_loop_1",
			message: "verifier gaps handed to explorer",
			data: { loop: 1 },
			artifactUri: "session://team-runs/run/details/1",
		});

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(entries.at(-1)?.data).toMatchObject({ kind: "run_detail", detailKind: "handoff", schemaVersion: 1 });
		expect(reader.get(runId)?.details).toEqual([
			expect.objectContaining({
				kind: "handoff",
				phaseId: "research_loop_1",
				message: "verifier gaps handed to explorer",
				data: { loop: 1 },
				artifactUri: "session://team-runs/run/details/1",
			}),
		]);
	});

	it("projects failed node errors into detail records", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		writer.recordNodeCompleted(runId, {
			phaseId: "debate",
			nodeId: "critic",
			role: "critic",
			model: "test/model",
			ok: false,
			durationMs: 1,
			output: "failed",
			error: "provider timeout",
		});

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.get(runId)?.details).toEqual([
			expect.objectContaining({ kind: "error", phaseId: "debate", nodeId: "critic", message: "provider timeout" }),
		]);
	});

	it("reduces generic phases and nodes into records", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "custom-chain", prompt: "hello" });
		writer.recordPhaseStarted(runId, "custom-chain");
		writer.recordNodeCompleted(runId, {
			phaseId: "custom-chain",
			nodeId: "agent_1",
			role: "agent_1",
			model: "test/model",
			ok: true,
			durationMs: 3,
			output: "hi",
		});
		writer.recordRunCompleted(runId, 4, "hi");

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.get(runId)).toMatchObject({
			id: runId,
			team: "team",
			protocol: "custom-chain",
			status: "completed",
			phases: ["custom-chain"],
			nodes: [expect.objectContaining({ phaseId: "custom-chain", nodeId: "agent_1", output: "hi" })],
			summary: "hi",
		});
	});

	it("tombstones records on the active branch", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "graph", prompt: "x" });
		writer.remove(runId);

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.get(runId)).toBeUndefined();
		expect(reader.list()).toEqual([]);
	});

	it("findOrphans returns non-terminal records whose orchestrator is dead", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const orphan = writer.startRun({ teamId: "orphan", protocol: "graph", prompt: "x" });
		const completed = writer.startRun({ teamId: "done", protocol: "graph", prompt: "x" });
		writer.recordRunCompleted(completed, 1, "done");
		for (const entry of entries) {
			const data = entry.data as { runId?: string; orchestratorPid?: number };
			if (data.runId === orphan) data.orchestratorPid = 999_999_999;
		}
		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.findOrphans().map((record) => record.id)).toEqual([orphan]);
	});

	it("continues sequence numbers after rehydrate", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "graph", prompt: "x" });
		writer.recordPhaseStarted(runId, "one");

		const reader = new TeamStateManager({ appendEntry: appendTo(entries) });
		reader.rehydrateFromSession({ getBranch: () => entries });
		reader.recordPhaseStarted(runId, "two");

		expect(entries.map((entry) => (entry.data as { seq: number }).seq)).toEqual([1, 2, 3]);
	});

	it("generates unique run ids", () => {
		const store = new TeamStateManager();
		const ids = new Set<string>();
		for (let i = 0; i < 10; i++) ids.add(store.startRun({ teamId: "team", protocol: "graph", prompt: "x" }));
		expect(ids.size).toBe(10);
	});

	it("ignores malformed session entries", () => {
		const reader = new TeamStateManager();
		reader.rehydrateFromSession({
			getBranch: () => [
				{ type: "custom", customType: TEAM_RUN_CUSTOM_TYPE, data: { kind: "run_started" } },
				{ type: "custom", customType: "other", data: {} },
			],
		});
		expect(reader.list()).toEqual([]);
	});

	it("ignores malformed run_detail entries without a valid detailKind", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		entries.push({
			type: "custom",
			customType: TEAM_RUN_CUSTOM_TYPE,
			data: { schemaVersion: 1, kind: "run_detail", runId, seq: 2, timestamp: Date.now(), orchestratorPid: process.pid, message: "missing detailKind" },
		});
		entries.push({
			type: "custom",
			customType: TEAM_RUN_CUSTOM_TYPE,
			data: { schemaVersion: 1, kind: "run_detail", detailKind: "bogus", runId, seq: 3, timestamp: Date.now(), orchestratorPid: process.pid, message: "bad detailKind" },
		});

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.get(runId)?.details).toEqual([]);
	});

	it("uses getEntries when getBranch is unavailable", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "graph", prompt: "x" });

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getEntries: () => entries });

		expect(reader.get(runId)?.team).toBe("team");
	});

	it("requestStop records stopping state and aborts registered controllers", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		const controller = new AbortController();
		writer.registerAbortController(runId, controller);

		const accepted = writer.requestStop(runId, "human stop");

		expect(accepted).toBe(true);
		expect(controller.signal.aborted).toBe(true);
		expect(writer.get(runId)).toMatchObject({ status: "stopping", stopReason: "human stop" });
		expect(writer.isStopRequested(runId)).toBe(true);
		expect(entries.at(-1)?.data).toMatchObject({ kind: "stop_requested", reason: "human stop" });
	});

	it("requestStop aborts controllers registered after a stop request", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.requestStop(runId, "pre-start stop");
		const controller = new AbortController();

		writer.registerAbortController(runId, controller);

		expect(controller.signal.aborted).toBe(true);
	});

	it("requestStop is idempotent and preserves the original reason", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });

		expect(writer.requestStop(runId, "first reason")).toBe(true);
		expect(writer.requestStop(runId, "second reason")).toBe(true);

		expect(writer.stopReason(runId)).toBe("first reason");
		expect(entries.filter((entry) => (entry.data as { kind?: string }).kind === "stop_requested")).toHaveLength(1);
	});

	it("terminal stop clears stop request and records stopped status", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.requestStop(runId, "human stop");

		writer.recordRunStopped(runId, 10, "human stop", "stopped by user");

		expect(writer.isStopRequested(runId)).toBe(false);
		expect(writer.get(runId)).toMatchObject({ status: "stopped", stopReason: "human stop", summary: "stopped by user" });
	});

	it("rehydration lets terminal stopped events win over stop_requested", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.requestStop(runId, "human stop");
		writer.recordRunStopped(runId, 10, "human stop");
		const reader = new TeamStateManager();

		reader.rehydrateFromSession({ getBranch: () => entries });

		expect(reader.isStopRequested(runId)).toBe(false);
		expect(reader.get(runId)).toMatchObject({ status: "stopped", stopReason: "human stop" });
	});

	it("failed terminal event clears stale stopReason", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.requestStop(runId, "human stop");

		writer.recordRunFailed(runId, "provider failed after stop");

		expect(writer.get(runId)).toMatchObject({ status: "failed", error: "provider failed after stop" });
		expect(writer.get(runId)?.stopReason).toBeUndefined();
	});

	it("requestStop rejects terminal records", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "research", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.recordRunCompleted(runId, 1, "done");

		expect(writer.requestStop(runId, "too late")).toBe(false);
		expect(writer.get(runId)).toMatchObject({ status: "completed" });
	});

	it("markFailed appends a failure event for an active record", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "graph", prompt: "x" });
		writer.rehydrateFromSession({ getBranch: () => entries });
		writer.markFailed(runId, "orchestrator died");

		expect(runIdOf(entries.at(-1) as CustomEntry)).toBe(runId);
		expect(entries.at(-1)?.data).toMatchObject({ kind: "run_failed", error: "orchestrator died" });
	});
});
