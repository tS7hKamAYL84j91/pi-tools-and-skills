/**
 * Agent API — High-level public interface for agent infrastructure.
 *
 * This is the contract layer that consumers (kanban, other extensions)
 * should import instead of reaching into registry internals or transports.
 *
 * Provides:
 * - findAgentByName(): look up an agent and get liveness + health summary
 * - findCurrentAgent(): look up this process' registry record
 * - sendAgentMessage(): deliver a message to an agent by ID
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	REGISTRY_DIR,
	isPidAlive,
	type AgentRecord,
} from "./agent-registry.js";
import { agentDisplayName, findAgentByDisplayName } from "./agent-names.js";
import { getMaildirTransport } from "./transports/maildir.js";

// ── Types ───────────────────────────────────────────────────────

/** Summary of an agent's liveness and health. */
export interface AgentInfo {
	id: string;
	/** Human-visible selector; duplicate registry names include a stable id suffix. */
	name: string;
	/** Raw mutable registry name. */
	registryName: string;
	pid: number;
	alive: boolean;
	heartbeatAge: number;
	model: string;
	status: string;
}

// ── Queries ─────────────────────────────────────────────────────

/**
 * Return all currently-alive registered agents.
 * `excludeName` (case-insensitive) drops one entry — typically the caller's
 * own agent name, since an agent including itself in a council would deadlock.
 */
export function listLiveAgents(excludeName?: string): AgentInfo[] {
	const records = readLiveAgentRecords();
	const exclude = excludeName?.toLowerCase();
	const visibleRecords = records.filter((record) => {
		const displayName = agentDisplayName(record, records).toLowerCase();
		return !exclude || (record.name.toLowerCase() !== exclude && displayName !== exclude);
	});
	return visibleRecords.map((record) => toAgentInfo(record, records, true));
}

/**
 * Find a registered agent by name (case-insensitive).
 * Returns agent info with liveness check, or null if not found.
 */
export function findAgentByName(name: string): AgentInfo | null {
	const records = readRegistryRecords();
	const rec = findAgentByDisplayName(records, name);
	if (!rec) {
		return null;
	}
	return toAgentInfo(rec, records, isPidAlive(rec.pid));
}

/** Find the registry record for a process in a cwd, normally this agent. */
export function findCurrentAgent(cwd: string, pid = process.pid): AgentInfo | null {
	const records = readRegistryRecords();
	const rec = records.find((record) => record.pid === pid && record.cwd === cwd);
	if (!rec) {
		return null;
	}
	return toAgentInfo(rec, records, isPidAlive(rec.pid));
}

function readRegistryRecords(): AgentRecord[] {
	try {
		if (!existsSync(REGISTRY_DIR)) {
			return [];
		}
		const records: AgentRecord[] = [];
		for (const file of readdirSync(REGISTRY_DIR)) {
			if (!file.endsWith(".json")) {
				continue;
			}
			try {
				const rec: AgentRecord = JSON.parse(
					readFileSync(join(REGISTRY_DIR, file), "utf-8"),
				);
				if (rec.name) {
					records.push(rec);
				}
			} catch {
				// Skip corrupt records.
			}
		}
		return records;
	} catch {
		return [];
	}
}

function readLiveAgentRecords(): AgentRecord[] {
	return readRegistryRecords().filter((record) => isPidAlive(record.pid));
}

function toAgentInfo(record: AgentRecord, records: readonly AgentRecord[], alive: boolean): AgentInfo {
	return {
		id: record.id,
		name: agentDisplayName(record, records),
		registryName: record.name,
		pid: record.pid,
		alive,
		heartbeatAge: Date.now() - record.heartbeat,
		model: record.model,
		status: alive ? record.status : "terminated",
	};
}

// ── Commands ────────────────────────────────────────────────────

const transport = getMaildirTransport();

/**
 * Send a message to an agent by ID.
 * Uses the Maildir transport for durable at-least-once delivery.
 * Returns true if accepted by the transport.
 */
export async function sendAgentMessage(
	agentId: string,
	from: string,
	text: string,
): Promise<boolean> {
	const stub: AgentRecord = {
		id: agentId, name: "", pid: 0, cwd: "",
		model: "", startedAt: 0, heartbeat: 0, status: "running",
	};
	const result = await transport.send(stub, from, text);
	return result.accepted;
}
