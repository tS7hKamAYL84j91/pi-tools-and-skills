/**
 * Pi Messaging — Agent-to-Agent Communication
 *
 * Provides tools for sending messages between registered agents.
 * Reads the shared agent registry (written by pi-panopticon) and
 * sends messages via Unix socket IPC.
 *
 * Responsibilities (messaging ONLY):
 * - agent_send tool (cast to a single peer)
 * - agent_send_durable tool (crash-safe Maildir delivery)
 * - agent_broadcast tool (fan out to all/filtered peers)
 * - /send command
 *
 * Does NOT provide: registry, heartbeat, monitoring (see pi-panopticon.ts)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { join } from "node:path";
import {
	type AgentRecord,
	readAllAgentRecords,
	socketSend,
	ensureInbox,
	inboxReadNew,
	inboxAcknowledge,
	inboxPruneCur,
} from "./agent-registry.js";

// ── Pure helpers ────────────────────────────────────────────────

function truncate(s: string, max = 200): string {
	return s.length <= max ? s : `${s.slice(0, max)}\u2026`;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

// ── Durable Maildir write (atomic tmp/ → new/) ─────────────────

interface WriteResult { ok: boolean; filename?: string; error?: string }

function durableWrite(targetId: string, from: string, text: string): WriteResult {
	try {
		const inboxBase = ensureInbox(targetId); // creates tmp/, new/, cur/ idempotently
		const ts = Date.now();
		const uuid = crypto.randomUUID();
		const filename = `${ts}-${uuid}.json`;
		const message = { id: uuid, from, text, ts };

		// Stage 1: Write to tmp/ (crash here = message never delivered, safe)
		const tmpPath = join(inboxBase, "tmp", filename);
		writeFileSync(tmpPath, JSON.stringify(message), "utf-8");

		// Stage 2: Atomic rename to new/ (POSIX guarantees atomicity)
		renameSync(tmpPath, join(inboxBase, "new", filename));

		return { ok: true, filename };
	} catch (err) {
		return { ok: false, error: String(err) };
	}
}

// ── Shared delivery core ────────────────────────────────────────

interface DeliveryResult { socketOk: boolean; inboxFilename?: string; inboxError?: string }

/** Best-effort: try socket first; only write inbox on failure (agent_send). */
async function socketOrInbox(peer: AgentRecord, from: string, text: string): Promise<DeliveryResult> {
	if (peer.socket && existsSync(peer.socket)) {
		try {
			const resp = await socketSend(peer.socket, { type: "cast", from, text });
			if (resp.ok) return { socketOk: true }; // delivered — no inbox write needed
		} catch { /* fall through to inbox */ }
	}
	const wr = durableWrite(peer.id, from, text);
	return { socketOk: false, inboxFilename: wr.filename, inboxError: wr.ok ? undefined : wr.error };
}

/** Durable: always write inbox first; also try socket for low latency (agent_send_durable + /send). */
async function inboxPlusSocket(peer: AgentRecord, from: string, text: string): Promise<DeliveryResult> {
	const wr = durableWrite(peer.id, from, text);
	if (!wr.ok) return { socketOk: false, inboxError: wr.error };
	let socketOk = false;
	if (peer.socket && existsSync(peer.socket)) {
		try {
			const resp = await socketSend(peer.socket, { type: "cast", from, text });
			socketOk = resp.ok;
		} catch { /* inbox is our guarantee */ }
	}
	return { socketOk, inboxFilename: wr.filename };
}

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let selfName: string | undefined;

	// ── Registry helpers ────────────────────────────────────────

	function getSelfRecord(): AgentRecord | undefined {
		return readAllAgentRecords().find((r) => r.pid === process.pid);
	}

	function getSelfName(): string {
		if (!selfName) selfName = getSelfRecord()?.name ?? "unknown";
		return selfName;
	}

	function resolvePeer(name: string): AgentRecord | undefined {
		const lower = name.toLowerCase();
		const self = getSelfRecord();
		return readAllAgentRecords().find(
			(r) => r.name.toLowerCase() === lower && (!self || r.id !== self.id),
		);
	}

	function peerNames(): string {
		const self = getSelfRecord();
		const names = readAllAgentRecords()
			.filter((r) => !self || r.id !== self.id)
			.map((r) => r.name);
		return names.length ? names.join(", ") : "(none)";
	}

	function notFound(name: string) {
		return textResult(
			`No agent named "${name}". Known peers: ${peerNames()}`,
			{ name, error: "not_found" },
		);
	}

	// ── Inbox draining (receives durable messages) ─────────────

	function drainInbox(): void {
		const selfId = readAllAgentRecords().find((r) => r.pid === process.pid)?.id;
		if (!selfId) return;
		const pending = inboxReadNew(selfId);
		for (const { filename, message } of pending) {
			try {
				pi.sendUserMessage(`[from ${message.from}]: ${message.text}`, { deliverAs: "followUp" });
			} catch {
				continue; // Don't acknowledge failed deliveries — retry next cycle
			}
			inboxAcknowledge(selfId, filename);
		}
		if (pending.length > 0) inboxPruneCur(selfId);
	}

	pi.on("session_start", async () => {
		const selfId = readAllAgentRecords().find((r) => r.pid === process.pid)?.id;
		if (selfId) {
			ensureInbox(selfId);
			drainInbox();
		}
	});

	pi.on("agent_end", async () => drainInbox());

	// ── /send command ───────────────────────────────────────────

	pi.registerCommand("send", {
		description: "Send a message to a named agent. Usage: /send <name> <message>",
		handler: async (args, ctx) => {
			const match = args?.match(/^(\S+)\s+(.+)$/s);
			if (!match?.[1] || !match[2]) {
				ctx.ui.notify("Usage: /send <name> <message>", "warning");
				return;
			}
			const [, peerName, msg] = match;
			const peer = resolvePeer(peerName);
			if (!peer) {
				ctx.ui.notify(`No agent named "${peerName}". Peers: ${peerNames()}`, "warning");
				return;
			}
			const preview = truncate(msg, 50);
			const d = await inboxPlusSocket(peer, getSelfName(), msg);
			if (d.socketOk) {
				ctx.ui.notify(`→ ${peerName}: ${preview} (socket + inbox)`, "info");
			} else if (d.inboxFilename) {
				ctx.ui.notify(`→ ${peerName}: ${preview} (queued in inbox)`, "info");
			} else {
				ctx.ui.notify(`Failed to reach "${peerName}": no socket, inbox write failed`, "error");
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

		async execute(_id, params, _signal) {
			const peer = resolvePeer(params.name);
			if (!peer) return notFound(params.name);

			const from = getSelfName();
			const preview = truncate(params.message);
			const d = await socketOrInbox(peer, from, params.message);

			if (d.socketOk) return textResult(
				`Sent to ${params.name}: ${preview}\n\nMessage delivered via socket. Use agent_peek "${params.name}" to see their activity.`,
				{ name: params.name, pattern: "cast", messageLength: params.message.length },
			);
			if (d.inboxFilename) return textResult(
				`Socket unavailable for "${params.name}". Message queued in Maildir inbox (durable).\n` +
				`Will deliver on agent's next turn or session start.\n\nSent: ${preview}`,
				{ name: params.name, pattern: "cast_fallback_durable", messageLength: params.message.length, filename: d.inboxFilename },
			);
			return textResult(
				`Failed to reach "${params.name}": socket down and inbox write failed.\nThe agent may not be running.`,
				{ name: params.name, error: "both_failed" },
			);
		},
	});

	// ── agent_send_durable tool ─────────────────────────────────

	pi.registerTool({
		name: "agent_send_durable",
		label: "Agent Send (Durable)",
		description:
			"Send a durable message to a named peer agent via Maildir inbox. " +
			"The message is atomically written to the agent's inbox (tmp/ → new/) and persists across " +
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

		async execute(_id, params, _signal) {
			const peer = resolvePeer(params.name);
			if (!peer) return notFound(params.name);

			const from = getSelfName();
			const preview = truncate(params.message);
			const d = await inboxPlusSocket(peer, from, params.message);

			if (d.inboxError) return textResult(
				`Failed to write durable message for "${params.name}": ${d.inboxError}`,
				{ name: params.name, error: d.inboxError, transport: "maildir" },
			);
			const method = d.socketOk
				? "Delivered via socket (+ durable backup in inbox)"
				: "Queued in Maildir inbox (will deliver on agent's next turn or wake)";
			return textResult(
				`Durable send to ${params.name}: ${preview}\n\n${method}\nFile: ${d.inboxFilename}`,
				{ name: params.name, pattern: "durable", socketDelivered: d.socketOk, messageLength: params.message.length, filename: d.inboxFilename },
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

		async execute(_id, params, _signal) {
			const self = getSelfRecord();
			const peers = readAllAgentRecords().filter((r) => !self || r.id !== self.id);
			const targets = params.filter
				? peers.filter((r) => r.name.toLowerCase().includes(params.filter?.toLowerCase() ?? ""))
				: peers;

			if (targets.length === 0) {
				return textResult(
					params.filter ? `No agents matching "${params.filter}".` : "No peer agents registered.",
					{ sent: 0 },
				);
			}

			const from = getSelfName();
			const results: { name: string; ok: boolean; error?: string }[] = [];

			for (const target of targets) {
				if (!target.socket || !existsSync(target.socket)) {
					results.push({ name: target.name, ok: false, error: "no socket" });
					continue;
				}
				try {
					const resp = await socketSend(target.socket, { type: "cast", from, text: params.message });
					results.push({ name: target.name, ok: resp.ok, error: resp.error });
				} catch (err) {
					results.push({ name: target.name, ok: false, error: String(err) });
				}
			}

			const sent = results.filter((r) => r.ok).length;
			const summary = results
				.map((r) => `  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? ` (${r.error})` : ""}`)
				.join("\n");

			return textResult(
				`Broadcast to ${targets.length} agent(s), ${sent} delivered:\n${summary}`,
				{ pattern: "broadcast", sent, failed: results.length - sent, targets: targets.map((t) => t.name) },
			);
		},
	});
}
