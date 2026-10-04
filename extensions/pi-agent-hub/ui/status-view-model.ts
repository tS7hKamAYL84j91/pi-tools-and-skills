/** Pure view-model helpers for the agent status display. */
import type { AgentRecord } from "../types.js";

interface AgentStatusSummary {
	peerCount: number;
	runningCount: number;
	waitingCount: number;
	label: string;
}

export function summarizeAgentStatus(records: readonly AgentRecord[], selfId: string): AgentStatusSummary {
	const peers = records.filter((record) => record.id !== selfId);
	const runningCount = peers.filter((record) => record.status === "running").length;
	const waitingCount = peers.filter((record) => record.status === "waiting").length;
	let label: string;
	if (peers.length === 0) {
		label = "solo";
	} else if (runningCount > 0 || waitingCount > 0) {
		const statusParts: string[] = [];
		if (runningCount > 0) {
			statusParts.push(`active:${runningCount}`);
		}
		if (waitingCount > 0) {
			statusParts.push(`idle:${waitingCount}`);
		}
		label = statusParts.join(" ");
	} else {
		label = `${peers.length} peer${peers.length !== 1 ? "s" : ""}`;
	}
	return { peerCount: peers.length, runningCount, waitingCount, label };
}
