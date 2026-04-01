/**
 * Shared agent registry types and utilities.
 *
 * Both pi-panopticon.ts and pi-messaging.ts use the same registry
 * directory (~/.pi/agents/) and the same record format. This module
 * provides the shared types and low-level IO functions so neither
 * extension duplicates the other.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ── Constants ───────────────────────────────────────────────────

export const REGISTRY_DIR = join(homedir(), ".pi", "agents");
export const STALE_MS = 30_000;
export const SOCKET_TIMEOUT_MS = 3_000;

// ── Types ───────────────────────────────────────────────────────

export type AgentStatus = "running" | "waiting" | "done" | "blocked" | "stalled" | "terminated" | "unknown";

export interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
	socket?: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	task?: string;
	inboxCapable?: boolean;
	pendingMessages?: number;
}

export interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	lines?: number;
	ref?: string;
	command?: string;
	payload?: unknown;
}

export interface SocketResponse {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

// ── Pure functions ──────────────────────────────────────────────

export function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export function ensureRegistryDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

/**
 * Read all agent records from the registry, filtering out stale/dead agents.
 * This is a read-only scan — it does NOT delete stale files.
 * Callers that need cleanup (panopticon) do that separately.
 */
export function readAllAgentRecords(): AgentRecord[] {
	try {
		if (!existsSync(REGISTRY_DIR)) return [];
		const now = Date.now();
		const records: AgentRecord[] = [];

		for (const file of readdirSync(REGISTRY_DIR)) {
			if (!file.endsWith(".json")) continue;
			try {
				const record: AgentRecord = JSON.parse(
					readFileSync(join(REGISTRY_DIR, file), "utf-8"),
				);
				if (!record.name) {
					record.name = basename(record.cwd) || record.id.slice(0, 8);
				}
				// Skip dead agents (stale heartbeat + PID gone)
				if (now - record.heartbeat > STALE_MS && !isPidAlive(record.pid)) continue;
				records.push(record);
			} catch { /* skip corrupt */ }
		}
		return records;
	} catch { return []; }
}

// ── Socket IO ───────────────────────────────────────────────────

import * as net from "node:net";

export function socketSend(socketPath: string, cmd: SocketCommand): Promise<SocketResponse> {
	return new Promise((resolve, reject) => {
		const client = net.createConnection({ path: socketPath }, () => {
			client.end(`${JSON.stringify(cmd)}\n`);
		});
		let buf = "";
		client.setTimeout(SOCKET_TIMEOUT_MS);
		client.on("data", (chunk) => { buf += chunk.toString(); });
		client.on("end", () => {
			try { resolve(JSON.parse(buf.trim()) as SocketResponse); }
			catch { resolve({ ok: false, error: "Invalid response from agent socket" }); }
		});
		client.on("timeout", () => { client.destroy(); reject(new Error("Socket timeout")); });
		client.on("error", (err) => { reject(new Error(`Socket error: ${err.message}`)); });
	});
}
