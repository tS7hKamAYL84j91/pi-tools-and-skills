/**
 * Agent API — High-level public interface for agent infrastructure.
 *
 * This is the contract layer that consumers (kanban, other extensions)
 * should import instead of reaching into registry internals or transports.
 *
 * Provides:
 * - findAgentByName(): look up an agent and get liveness + health summary
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
import { getMaildirTransport } from "./transports/maildir.js";

// ── Types ───────────────────────────────────────────────────────

/** Summary of an agent's liveness and health. */
export interface AgentInfo {
	id: string;
	name: string;
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
	try {
		if (!existsSync(REGISTRY_DIR)) return [];
		const exclude = excludeName?.toLowerCase();
		const out: AgentInfo[] = [];
		for (const f of readdirSync(REGISTRY_DIR)) {
			if (!f.endsWith(".json")) continue;
			try {
				const rec: AgentRecord = JSON.parse(
					readFileSync(join(REGISTRY_DIR, f), "utf-8"),
				);
				if (!rec.name) continue;
				if (exclude && rec.name.toLowerCase() === exclude) continue;
				if (!isPidAlive(rec.pid)) continue;
				out.push({
					id: rec.id,
					name: rec.name,
					pid: rec.pid,
					alive: true,
					heartbeatAge: Date.now() - rec.heartbeat,
					model: rec.model,
					status: rec.status,
				});
			} catch { /* skip corrupt file */ }
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * Find a registered agent by name (case-insensitive).
 * Returns agent info with liveness check, or null if not found.
 */
export function findAgentByName(name: string): AgentInfo | null {
	try {
		if (!existsSync(REGISTRY_DIR)) return null;
		const lower = name.toLowerCase();
		for (const f of readdirSync(REGISTRY_DIR)) {
			if (!f.endsWith(".json")) continue;
			try {
				const rec: AgentRecord = JSON.parse(
					readFileSync(join(REGISTRY_DIR, f), "utf-8"),
				);
				if (rec.name?.toLowerCase() !== lower) continue;
				const alive = isPidAlive(rec.pid);
				return {
					id: rec.id,
					name: rec.name,
					pid: rec.pid,
					alive,
					heartbeatAge: Date.now() - rec.heartbeat,
					model: rec.model,
					status: alive ? rec.status : "terminated",
				};
			} catch { /* skip corrupt file */ }
		}
	} catch { /* registry dir unreadable */ }
	return null;
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
