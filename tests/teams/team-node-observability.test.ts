import { describe, expect, it } from "vitest";

import { TeamStateManager } from "../../extensions/pi-panopticon/teams/state.js";
import { computeNodeStall } from "../../extensions/pi-panopticon/teams/team-runtime.js";
import type { TeamRunNodeRecord } from "../../extensions/pi-panopticon/teams/types.js";

interface CustomEntry {
	type: "custom";
	customType: string;
	data?: unknown;
}

function appendTo(entries: CustomEntry[]) {
	return (customType: string, data?: unknown) => entries.push({ type: "custom", customType, data });
}

function mkNode(overrides: Partial<TeamRunNodeRecord> & { phaseId: string; nodeId: string }): TeamRunNodeRecord {
	const { phaseId, nodeId, role, model, ok, durationMs, output, ...rest } = overrides;
	return {
		phaseId,
		nodeId,
		role: role ?? nodeId,
		model: model ?? "test/model",
		ok: ok ?? false,
		durationMs: durationMs ?? 0,
		output: output ?? "",
		...rest,
	};
}

describe("node observability", () => {
	it("node_started creates a running node record", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeStarted(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2" });

		const run = store.get(runId);
		expect(run?.nodes).toHaveLength(1);
		expect(run?.nodes[0]).toMatchObject({
			phaseId: "debate",
			nodeId: "synthesis",
			role: "synthesis",
			model: "glm-5.2",
			status: "running",
		});
		expect(run?.nodes[0]?.startedAt).toBeDefined();
		expect(run?.nodes[0]?.updatedAt).toBeDefined();
	});

	it("node_heartbeat updates running node state", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeStarted(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2" });
		store.recordNodeHeartbeat(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2", elapsedMs: 5000, runningWorkers: 1 });

		const run = store.get(runId);
		expect(run?.nodes[0]).toMatchObject({
			status: "running",
			runningWorkers: 1,
		});
	});

	it("node_completed transitions running node to completed", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeStarted(runId, { phaseId: "debate", nodeId: "gen_1", role: "generation_1", model: "test/model" });
		store.recordNodeCompleted(runId, {
			phaseId: "debate",
			nodeId: "gen_1",
			role: "generation_1",
			model: "test/model",
			ok: true,
			durationMs: 42,
			output: "result",
		});

		const run = store.get(runId);
		expect(run?.nodes).toHaveLength(1);
		expect(run?.nodes[0]).toMatchObject({
			status: "completed",
			ok: true,
			durationMs: 42,
			output: "result",
		});
	});

	it("node_completed without node_started pushes a legacy record (backward compat)", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeCompleted(runId, {
			phaseId: "debate",
			nodeId: "gen_1",
			role: "generation_1",
			model: "test/model",
			ok: true,
			durationMs: 42,
			output: "result",
		});

		const run = store.get(runId);
		expect(run?.nodes).toHaveLength(1);
		expect(run?.nodes[0]?.status).toBe("completed");
	});

	it("stop_requested marks running nodes as stopped", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeStarted(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2" });
		store.requestStop(runId, "user stop");

		const run = store.get(runId);
		expect(run?.nodes[0]?.status).toBe("stopped");
	});

	it("run_failed marks running nodes as failed", () => {
		const entries: CustomEntry[] = [];
		const store = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = store.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		store.recordPhaseStarted(runId, "debate");
		store.recordNodeStarted(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2" });
		store.recordRunFailed(runId, "handler error");

		const run = store.get(runId);
		expect(run?.nodes[0]?.status).toBe("failed");
	});

	it("rehydration preserves node_started and heartbeat events", () => {
		const entries: CustomEntry[] = [];
		const writer = new TeamStateManager({ appendEntry: appendTo(entries) });
		const runId = writer.startRun({ teamId: "team", protocol: "debate", prompt: "x" });
		writer.recordPhaseStarted(runId, "debate");
		writer.recordNodeStarted(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2" });
		writer.recordNodeHeartbeat(runId, { phaseId: "debate", nodeId: "synthesis", role: "synthesis", model: "glm-5.2", elapsedMs: 5000, runningWorkers: 1 });

		const reader = new TeamStateManager();
		reader.rehydrateFromSession({ getBranch: () => entries });

		const run = reader.get(runId);
		expect(run?.nodes[0]).toMatchObject({
			nodeId: "synthesis",
			status: "running",
			runningWorkers: 1,
		});
	});

	it("computeNodeStall detects no_heartbeat after threshold", () => {
		const node = mkNode({
			phaseId: "debate",
			nodeId: "synthesis",
			status: "running",
			startedAt: 1000,
			updatedAt: 1000,
			runningWorkers: 1,
		});
		const now = 1000 + 31_000;
		expect(computeNodeStall(node, now)).toEqual({ stalled: true, reason: "no_heartbeat" });
	});

	it("computeNodeStall detects idle_stall when runningWorkers is 0", () => {
		const node = mkNode({
			phaseId: "debate",
			nodeId: "synthesis",
			status: "running",
			startedAt: 1000,
			updatedAt: 1000,
			runningWorkers: 0,
		});
		const now = 1000 + 61_000;
		expect(computeNodeStall(node, now)).toEqual({ stalled: true, reason: "idle_stall" });
	});

	it("computeNodeStall returns not stalled for healthy running nodes", () => {
		const node = mkNode({
			phaseId: "debate",
			nodeId: "synthesis",
			status: "running",
			startedAt: 1000,
			updatedAt: 1000,
			runningWorkers: 1,
		});
		const now = 1000 + 10_000;
		expect(computeNodeStall(node, now)).toEqual({ stalled: false });
	});

	it("computeNodeStall returns not stalled for completed nodes", () => {
		const node = mkNode({
			phaseId: "debate",
			nodeId: "synthesis",
			status: "completed",
			ok: true,
			durationMs: 5000,
		});
		expect(computeNodeStall(node)).toEqual({ stalled: false });
	});
});
