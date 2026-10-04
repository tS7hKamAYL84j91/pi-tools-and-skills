/** Reconciliation findings derived from agent and operational state. */

import { findAgentByName } from "../../../lib/agent-api.js";
import type { AgentRecord } from "../../../lib/agent-registry.js";
import type { Registry } from "../types.js";
import type { OperationalStateStore } from "./state.js";

const STALE_ACTIVITY_MS = 30 * 60_000;
const FRESH_HEARTBEAT_MS = 60_000;

type FindingLevel = "actionable" | "informational";

export interface ReconciliationFinding {
	heuristic: string;
	summary: string;
	level: FindingLevel;
}

type RegistryPeer = AgentRecord;

interface ConfirmedPeerState {
	id: string;
	name: string;
	pid: number;
	alive: boolean;
	heartbeatAge: number;
	status: string;
	pendingMessages: number;
	confirmed: boolean;
}

function confirmedPeerState(peer: RegistryPeer): ConfirmedPeerState {
	if (peer.kind === "external") {
		return {
			id: peer.id,
			name: peer.name,
			pid: 0,
			alive: true,
			heartbeatAge: 0,
			status:
				peer.status === "waiting" ? "waiting" : (peer.status ?? "waiting"),
			pendingMessages: peer.pendingMessages ?? 0,
			confirmed: true,
		};
	}
	const info = findAgentByName(peer.name);
	if (info?.id === peer.id) {
		return {
			id: info.id,
			name: info.name,
			pid: info.pid,
			alive: info.alive,
			heartbeatAge: info.heartbeatAge,
			status: info.status,
			pendingMessages: peer.pendingMessages ?? 0,
			confirmed: true,
		};
	}

	return {
		id: peer.id,
		name: peer.name,
		pid: peer.pid,
		alive: peer.status !== "terminated",
		heartbeatAge: Date.now() - peer.heartbeat,
		status: peer.status,
		pendingMessages: peer.pendingMessages ?? 0,
		confirmed: false,
	};
}

function actionableAgentFindings(
	peer: RegistryPeer,
	confirmed: ConfirmedPeerState,
): ReconciliationFinding[] {
	const findings: ReconciliationFinding[] = [];
	if (confirmed.pendingMessages > 0) {
		findings.push({
			heuristic: "pending-messages",
			summary: `Agent "${confirmed.name}" has ${confirmed.pendingMessages} pending message(s).`,
			level: "actionable",
		});
	}

	if (peer.status === "blocked" || confirmed.status === "blocked") {
		findings.push({
			heuristic: "blocked-agent",
			summary: `Agent "${confirmed.name}" self-reports blocked status.`,
			level: "actionable",
		});
	}

	if (
		confirmed.confirmed &&
		!confirmed.alive &&
		peer.status !== "terminated" &&
		peer.status !== "done" &&
		peer.kind !== "external"
	) {
		findings.push({
			heuristic: "silent-done",
			summary: `Agent "${confirmed.name}" (pid ${confirmed.pid}) appears terminated but registry still shows status="${peer.status}".`,
			level: "actionable",
		});
	}

	if (
		confirmed.confirmed &&
		confirmed.alive &&
		confirmed.status === "stalled"
	) {
		findings.push({
			heuristic: "stale-worker",
			summary: `Agent "${confirmed.name}" is stalled after confirmation; heartbeat age is ${Math.round(confirmed.heartbeatAge / 60_000)}m.`,
			level: "actionable",
		});
	}

	return findings;
}

function isOperationallyQuiet(
	peer: RegistryPeer,
	confirmed: ConfirmedPeerState,
): boolean {
	if (confirmed.pendingMessages > 0) return false;
	if (peer.status === "blocked" || confirmed.status === "blocked") return false;
	if (!confirmed.confirmed) return true;
	if (!confirmed.alive)
		return peer.status === "done" || peer.status === "terminated";
	if (confirmed.status === "stalled") return false;
	if (
		confirmed.status === "waiting" ||
		confirmed.status === "running" ||
		confirmed.status === "done"
	)
		return true;
	return confirmed.heartbeatAge <= FRESH_HEARTBEAT_MS;
}

export function checkAgentHealth(
	registry: Registry,
	selfId: string,
): ReconciliationFinding[] {
	const findings: ReconciliationFinding[] = [];
	const peers = registry.readAllPeers();
	for (const peer of peers) {
		if (peer.id === selfId) continue;
		findings.push(...actionableAgentFindings(peer, confirmedPeerState(peer)));
	}
	return findings;
}

export function checkStaleActivity(
	stateStore: OperationalStateStore,
	registry: Registry,
	selfId: string,
): ReconciliationFinding[] {
	const state = stateStore.getState();
	if (!state) return [];
	const age = Date.now() - state.lastActiveAt;
	if (age <= STALE_ACTIVITY_MS) return [];

	const peers = registry.readAllPeers().filter((peer) => peer.id !== selfId);
	const allPeersQuiet = peers.every((peer) =>
		isOperationallyQuiet(peer, confirmedPeerState(peer)),
	);
	if (allPeersQuiet) return [];

	return [
		{
			heuristic: "stale-activity",
			summary: `No workspace activity for ${Math.round(age / 60_000)}m. Last active channel: ${state.sourceChannel}/${state.humanIdentity}.`,
			level: "informational",
		},
	];
}
