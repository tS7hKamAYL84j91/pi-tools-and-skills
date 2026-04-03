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
	renameSync,
	unlinkSync,
} from "node:fs";
import * as net from "node:net";
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
	pendingMessages?: number;
	sessionDir?: string;
	sessionFile?: string;
}

export interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	lines?: number;
}

export interface SocketResponse {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

// ── Pure helpers ────────────────────────────────────────────────

export function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

export function ensureRegistryDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

export function readAllAgentRecords(): AgentRecord[] {
	try {
		const now = Date.now();
		return readdirSync(REGISTRY_DIR)
			.filter((f) => f.endsWith(".json"))
			.flatMap((file) => {
				try {
					const record = JSON.parse(readFileSync(join(REGISTRY_DIR, file), "utf-8")) as AgentRecord;
					if (!record.name) record.name = basename(record.cwd) || record.id.slice(0, 8);
					if (now - record.heartbeat > STALE_MS && !isPidAlive(record.pid)) return [];
					return [record];
				} catch { return []; }
			});
	} catch { return []; }
}

export function writeAgentRecord(record: AgentRecord): void {
	ensureRegistryDir();
	const path = join(REGISTRY_DIR, `${record.id}.json`);
	writeFileSync(path, JSON.stringify(record, null, 2), "utf-8");
}

// ── Inbox Maildir IO ────────────────────────────────────────────

export interface InboxMessage {
	id: string;
	from: string;
	text: string;
	ts: number;
	metadata?: Record<string, unknown>;
}

export function ensureInbox(agentId: string): string {
	const inboxPath = join(REGISTRY_DIR, agentId, "inbox");
	for (const sub of ["tmp", "new", "cur"]) {
		mkdirSync(join(inboxPath, sub), { recursive: true });
	}
	return inboxPath;
}

export function inboxReadNew(agentId: string): { filename: string; message: InboxMessage }[] {
	try {
		const newDir = join(REGISTRY_DIR, agentId, "inbox", "new");
		return readdirSync(newDir)
			.filter((f) => f.endsWith(".json"))
			.sort()
			.flatMap((f) => {
				try {
					return [{ filename: f, message: JSON.parse(readFileSync(join(newDir, f), "utf-8")) as InboxMessage }];
				} catch { return []; }
			});
	} catch { return []; }
}

export function inboxAcknowledge(agentId: string, filename: string): void {
	try {
		renameSync(
			join(REGISTRY_DIR, agentId, "inbox", "new", filename),
			join(REGISTRY_DIR, agentId, "inbox", "cur", filename),
		);
	} catch { /* best-effort: message may already be moved */ }
}

export function inboxPruneCur(agentId: string, keep = 50): void {
	try {
		const curDir = join(REGISTRY_DIR, agentId, "inbox", "cur");
		const files = readdirSync(curDir).filter((f) => f.endsWith(".json")).sort();
		for (const f of files.slice(0, files.length - keep)) {
			try { unlinkSync(join(curDir, f)); } catch { /* */ }
		}
	} catch { /* */ }
}

// ── Socket IO ───────────────────────────────────────────────────

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
