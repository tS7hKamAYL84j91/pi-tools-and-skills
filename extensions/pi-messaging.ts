/**
 * Pi Messaging — Agent-to-Agent Communication
 *
 * Provides tools for sending messages between registered agents.
 * Reads the shared agent registry (written by pi-panopticon) and
 * sends messages via Unix socket IPC.
 *
 * Responsibilities (messaging ONLY):
 * - agent_send tool (cast to a single peer)
 * - agent_broadcast tool (fan out to all/filtered peers)
 * - /send command
 *
 * Does NOT provide: registry, heartbeat, monitoring (see pi-panopticon.ts)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import * as crypto from "node:crypto";
import * as net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ── Types (shared with pi-panopticon) ───────────────────────────

interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
	socket?: string;
	startedAt: number;
	heartbeat: number;
	status: string;
	task?: string;
	inboxCapable?: boolean;
	pendingMessages?: number;
}

interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	[key: string]: unknown;
}

interface SocketResponse {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

// ── Constants ───────────────────────────────────────────────────

const REGISTRY_DIR = join(homedir(), ".pi", "agents");
const STALE_MS = 30_000;
const SOCKET_TIMEOUT_MS = 3_000;

// ── Registry read (read-only, no writes) ────────────────────────

function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Read all live agent records from the shared registry. */
function readAllRecords(): AgentRecord[] {
	try {
		if (!existsSync(REGISTRY_DIR)) return [];
		const now = Date.now();
		const records: AgentRecord[] = [];

		for (const file of readdirSync(REGISTRY_DIR)) {
			if (!file.endsWith(".json")) continue;
			try {
				const record: AgentRecord = JSON.parse(readFileSync(join(REGISTRY_DIR, file), "utf-8"));
				if (!record.name) record.name = basename(record.cwd) || record.id.slice(0, 8);
				// Skip dead agents
				if (now - record.heartbeat > STALE_MS && !isPidAlive(record.pid)) continue;
				records.push(record);
			} catch { /* skip corrupt */ }
		}
		return records;
	} catch { return []; }
}

// ── Socket IO ───────────────────────────────────────────────────

function socketSend(socketPath: string, cmd: SocketCommand): Promise<SocketResponse> {
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

// ── Durable Maildir write (atomic tmp/ → new/) ─────────────────

function durableWrite(targetId: string, from: string, text: string, metadata?: Record<string, unknown>): { ok: boolean; filename?: string; error?: string } {
	try {
		const inboxBase = join(REGISTRY_DIR, targetId, "inbox");
		const tmpDir = join(inboxBase, "tmp");
		const newDir = join(inboxBase, "new");

		// Ensure inbox dirs exist (idempotent)
		for (const dir of [tmpDir, newDir, join(inboxBase, "cur")]) {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		}

		const ts = Date.now();
		const uuid = crypto.randomUUID();
		const filename = `${ts}-${uuid}.json`;

		const message = {
			id: uuid,
			from,
			text,
			ts,
			...(metadata ? { metadata } : {}),
		};

		// Stage 1: Write to tmp/ (crash here = message never delivered, safe)
		const tmpPath = join(tmpDir, filename);
		writeFileSync(tmpPath, JSON.stringify(message), "utf-8");

		// Stage 2: Atomic rename to new/ (POSIX guarantees atomicity)
		const newPath = join(newDir, filename);
		renameSync(tmpPath, newPath);

		return { ok: true, filename };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ── Helpers ─────────────────────────────────────────────────────

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// We need to know our own ID to exclude self from targets.
	// Read it from the registry by matching our PID.
	let selfName: string | undefined;

	function getSelfRecord(): AgentRecord | undefined {
		return readAllRecords().find((r) => r.pid === process.pid);
	}

	function getSelfName(): string {
		if (!selfName) {
			const self = getSelfRecord();
			selfName = self?.name ?? "unknown";
		}
		return selfName;
	}

	function resolvePeer(name: string): AgentRecord | undefined {
		const lower = name.toLowerCase();
		const self = getSelfRecord();
		return readAllRecords().find((r) =>
			r.name.toLowerCase() === lower && (!self || r.id !== self.id)
		);
	}

	function peerNames(): string {
		const self = getSelfRecord();
		const names = readAllRecords()
			.filter((r) => !self || r.id !== self.id)
			.map((r) => r.name);
		return names.length ? names.join(", ") : "(none)";
	}

	// ── /send command ───────────────────────────────────────────

	pi.registerCommand("send", {
		description: "Send a message to a named agent. Usage: /send <name> <message>",
		handler: async (args, ctx) => {
			const match = args?.match(/^(\S+)\s+(.+)$/s);
			if (!match?.[1] || !match[2]) {
				ctx.ui.notify("Usage: /send <name> <message>", "warning");
				return;
			}

			const peer = resolvePeer(match[1]);
			if (!peer) {
				ctx.ui.notify(`No agent named "${match[1]}". Peers: ${peerNames()}`, "warning");
				return;
			}

			const from = getSelfName();
			const preview = match[2].slice(0, 50) + (match[2].length > 50 ? "…" : "");

			// Always write durably first
			const writeResult = durableWrite(peer.id, from, match[2]);

			// Then try socket for immediate delivery
			if (peer.socket && existsSync(peer.socket)) {
				try {
					await socketSend(peer.socket, {
						type: "cast",
						from,
						text: match[2],
					});
					ctx.ui.notify(`→ ${match[1]}: ${preview} (socket + inbox)`, "info");
					return;
				} catch {
					// Socket failed — durable write is our fallback
				}
			}

			if (writeResult.ok) {
				ctx.ui.notify(`→ ${match[1]}: ${preview} (queued in inbox)`, "info");
			} else {
				ctx.ui.notify(`Failed to reach "${match[1]}": no socket, inbox write failed`, "error");
			}
		},
	});

	// ── agent_send tool ─────────────────────────────────────────

	pi.registerTool({
		name: "agent_send",
		label: "Agent Send",
		description:
			"Send a message to a named peer agent. Resolves the name from the registry " +
			"and delivers the message via Unix socket IPC. " +
			"Use agent_peek first to see available agents.",
		promptSnippet: "Send a message to a named peer agent",
		promptGuidelines: [
			"Use agent_peek (no target) first to discover peers before sending.",
			"After agent_send, wait a moment then agent_peek the same name to read the reply.",
			"Do not send to yourself.",
		],
		parameters: Type.Object({
			name: Type.String({ description: 'Agent name (e.g. "alice", "api-builder")' }),
			message: Type.String({ description: "Message to send" }),
		}),

		async execute(_toolCallId, params, _signal) {
			const peer = resolvePeer(params.name);
			if (!peer) {
				return textResult(
					`No agent named "${params.name}". Known peers: ${peerNames()}`,
					{ name: params.name, error: "not_found" },
				);
			}

			const from = getSelfName();
			const preview = params.message.slice(0, 200) + (params.message.length > 200 ? "\u2026" : "");
			const sockPath = peer.socket;

			// Try socket first (low latency path)
			if (sockPath && existsSync(sockPath)) {
				try {
					const resp = await socketSend(sockPath, {
						type: "cast",
						from,
						text: params.message,
					});
					if (resp.ok) {
						return textResult(
							`Sent to ${params.name}: ${preview}\n\nMessage delivered via socket. Use agent_peek "${params.name}" to see their activity.`,
							{ name: params.name, pattern: "cast", messageLength: params.message.length },
						);
					}
				} catch {
					// Socket failed — fall through to durable write
				}
			}

			// Graceful fallback: write to Maildir inbox (durable, at-least-once)
			const writeResult = durableWrite(peer.id, from, params.message);
			if (writeResult.ok) {
				return textResult(
					`Socket unavailable for "${params.name}". Message queued in Maildir inbox (durable).\n` +
					`Will deliver on agent's next turn or session start.\n\nSent: ${preview}`,
					{ name: params.name, pattern: "cast_fallback_durable", messageLength: params.message.length, filename: writeResult.filename },
				);
			}

			return textResult(
				`Failed to reach "${params.name}": socket down and inbox write failed.\nThe agent may not be running.`,
				{ name: params.name, error: "both_failed" },
			);
		},
	});

	// ── agent_broadcast tool ────────────────────────────────────

	pi.registerTool({
		name: "agent_broadcast",
		label: "Agent Broadcast",
		description:
			"Broadcast a message to all registered agents (or a filtered subset). " +
			"Each agent receives the message as an async cast via their socket.",
		promptSnippet: "Broadcast a message to all registered agents",
		parameters: Type.Object({
			message: Type.String({ description: "Message to broadcast" }),
			filter: Type.Optional(
				Type.String({ description: "Filter agents by name pattern (substring match). Omit for all peers." }),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const self = getSelfRecord();
			const allPeers = readAllRecords().filter((r) => !self || r.id !== self.id);
			const targets = params.filter
				? allPeers.filter((r) => r.name.toLowerCase().includes(params.filter?.toLowerCase() ?? ""))
				: allPeers;

			if (targets.length === 0) {
				return textResult(
					params.filter ? `No agents matching "${params.filter}".` : "No peer agents registered.",
					{ sent: 0 },
				);
			}

			const from = getSelfName();
			const results: { name: string; ok: boolean; error?: string }[] = [];

			for (const target of targets) {
				const sockPath = target.socket;
				if (!sockPath || !existsSync(sockPath)) {
					results.push({ name: target.name, ok: false, error: "no socket" });
					continue;
				}
				try {
					const resp = await socketSend(sockPath, { type: "cast", from, text: params.message });
					results.push({ name: target.name, ok: resp.ok, error: resp.error });
				} catch (err) {
					results.push({ name: target.name, ok: false, error: String(err) });
				}
			}

			const sent = results.filter((r) => r.ok).length;
			const summary = results.map((r) =>
				`  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? ` (${r.error})` : ""}`
			).join("\n");

			return textResult(
				`Broadcast to ${targets.length} agent(s), ${sent} delivered:\n${summary}`,
				{ pattern: "broadcast", sent, failed: results.length - sent, targets: targets.map((t) => t.name) },
			);
		},
	});

	// ── agent_send_durable tool ────────────────────────────────

	pi.registerTool({
		name: "agent_send_durable",
		label: "Agent Send (Durable)",
		description:
			"Send a durable message to a named peer agent via Maildir inbox. " +
			"The message is atomically written to the agent's inbox (tmp/ \u2192 new/) and persists across " +
			"crashes, Mac sleep, and agent restarts. Also attempts socket delivery for low latency. " +
			"If the socket is down, the message is still queued and delivered when the agent wakes.",
		promptSnippet: "Send a crash-safe durable message to a peer agent",
		promptGuidelines: [
			"Prefer agent_send_durable over agent_send for important messages that must not be lost.",
			"Messages are delivered at-least-once: on session_start (wake from sleep) and on agent_end (between turns).",
			"If the agent is offline, the message queues in their Maildir inbox and is delivered when they come back.",
		],
		parameters: Type.Object({
			name: Type.String({ description: 'Agent name (e.g. "alice", "api-builder")' }),
			message: Type.String({ description: "Message to send" }),
		}),

		async execute(_toolCallId, params, _signal) {
			const peer = resolvePeer(params.name);
			if (!peer) {
				return textResult(
					`No agent named "${params.name}". Known peers: ${peerNames()}`,
					{ name: params.name, error: "not_found" },
				);
			}

			const from = getSelfName();
			const preview = params.message.slice(0, 200) + (params.message.length > 200 ? "\u2026" : "");

			// Stage 1: Durable write (atomic tmp/ \u2192 new/)
			const writeResult = durableWrite(peer.id, from, params.message);
			if (!writeResult.ok) {
				return textResult(
					`Failed to write durable message for "${params.name}": ${writeResult.error}`,
					{ name: params.name, error: writeResult.error, transport: "maildir" },
				);
			}

			// Stage 2: Opportunistic socket delivery for low latency
			let socketDelivered = false;
			const sockPath = peer.socket;
			if (sockPath && existsSync(sockPath)) {
				try {
					const resp = await socketSend(sockPath, {
						type: "cast",
						from,
						text: params.message,
					});
					socketDelivered = resp.ok;
				} catch {
					// Socket failed — message is still durably queued, no error
				}
			}

			const deliveryMethod = socketDelivered
				? "Delivered via socket (+ durable backup in inbox)"
				: "Queued in Maildir inbox (will deliver on agent's next turn or wake)";

			return textResult(
				`Durable send to ${params.name}: ${preview}\n\n${deliveryMethod}\nFile: ${writeResult.filename}`,
				{
					name: params.name,
					pattern: "durable",
					socketDelivered,
					messageLength: params.message.length,
					filename: writeResult.filename,
				},
			);
		},
	});
}
