/** Fold protocol-neutral team events into current run records. */
import { TEAM_RUN_RECORD_VERSION, detailRecord, nodeRecord } from "./team-state-codecs.js";
import type { TeamRunEvent } from "./team-state-codecs.js";
import type { TeamRunRecord } from "./types.js";

export function applyTeamRunEvent(records: Map<string, TeamRunRecord>, event: TeamRunEvent): void {
	if (event.kind === "run_started") {
		records.set(event.runId, {
			version: TEAM_RUN_RECORD_VERSION,
			id: event.runId,
			team: event.teamId,
			protocol: event.protocol,
			prompt: event.input.prompt,
			status: "pending",
			startedAt: event.timestamp,
			orchestratorPid: event.orchestratorPid,
			phases: [],
			nodes: [],
			details: [],
		});
		return;
	}
	const record = records.get(event.runId);
	if (!record) return;
	if (event.kind === "phase_started") {
		record.status = "running";
		if (!record.phases.includes(event.phaseId)) record.phases.push(event.phaseId);
	} else if (event.kind === "node_started") {
		let node = record.nodes.find((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		if (!node) {
			node = {
				phaseId: event.phaseId,
				nodeId: event.nodeId,
				role: event.role,
				model: event.model,
				ok: false,
				durationMs: 0,
				output: "",
				status: "running",
				startedAt: event.timestamp,
				updatedAt: event.timestamp,
				runningWorkers: 1,
			};
			record.nodes.push(node);
		}
	} else if (event.kind === "node_heartbeat") {
		const node = record.nodes.find((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		if (node) {
			node.updatedAt = event.timestamp;
			node.runningWorkers = event.runningWorkers;
		}
	} else if (event.kind === "node_completed") {
		const existingIndex = record.nodes.findIndex((n) => n.phaseId === event.phaseId && n.nodeId === event.nodeId);
		const newNode = nodeRecord(event);
		if (existingIndex >= 0) {
			record.nodes[existingIndex] = { ...record.nodes[existingIndex], ...newNode };
		} else {
			record.nodes.push(newNode);
		}
		if (!event.ok && event.error) record.details.push(detailRecord({ ...event, kind: "run_detail", detailKind: "error", message: event.error }));
	} else if (event.kind === "run_detail") {
		record.details.push(detailRecord(event));
	} else if (event.kind === "stop_requested") {
		record.status = "stopping";
		record.stopReason = event.reason;
		for (const node of record.nodes) {
			if (node.status === "running") node.status = "stopped";
		}
	} else if (event.kind === "run_stopped") {
		record.status = "stopped";
		record.stopReason = event.reason;
		record.completedAt = event.timestamp;
		if (event.summary) record.summary = event.summary;
		if (event.resultArtifactPath) record.resultArtifactPath = event.resultArtifactPath;
	} else if (event.kind === "run_completed") {
		record.status = "completed";
		delete record.stopReason;
		record.completedAt = event.timestamp;
		if (event.summary) record.summary = event.summary;
		if (event.resultArtifactPath) record.resultArtifactPath = event.resultArtifactPath;
	} else if (event.kind === "run_failed") {
		record.status = "failed";
		delete record.stopReason;
		record.error = event.error;
		record.completedAt = event.timestamp;
		for (const node of record.nodes) {
			if (node.status === "running") node.status = "failed";
		}
	} else if (event.kind === "run_tombstoned") {
		records.delete(event.runId);
	}
}

export function reduceTeamRunEvents(events: readonly TeamRunEvent[]): Map<string, TeamRunRecord> {
	const records = new Map<string, TeamRunRecord>();
	for (const event of [...events].sort((a, b) => a.seq - b.seq)) applyTeamRunEvent(records, event);
	return records;
}
