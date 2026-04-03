/**
 * Pi Messaging — Agent-to-Agent Communication
 *
 * Provides tools for sending messages between registered agents.
 * Delegates all transport to injected MessageTransport implementations.
 *
 * Tools:
 * - agent_send (send to a single peer)
 * - agent_broadcast (fan out to all/filtered peers)
 * - /send command
 *
 * The transport determines delivery semantics (at-least-once,
 * at-most-once, etc.) — this extension doesn't know or care.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	type AgentRecord,
	readAllAgentRecords,
	writeAgentRecord,
} from "../lib/agent-registry.js";
import type { MessageTransport } from "../lib/message-transport.js";
import { createMaildirTransport } from "../lib/transports/maildir.js";

import { ok } from "../lib/tool-result.js";

// ── Pure helpers ────────────────────────────────────────────────

function truncate(s: string, max = 200): string {
	return s.length <= max ? s : `${s.slice(0, max)}\u2026`;
}

// ── Config ──────────────────────────────────────────────────────

export interface MessagingConfig {
	/** Transport for point-to-point sends (agent_send, /send). */
	send: MessageTransport;
	/** Transport for broadcast (agent_broadcast). */
	broadcast: MessageTransport;
}

// ── Factory ─────────────────────────────────────────────────────

export function createMessagingExtension(config: MessagingConfig) {
	return (pi: ExtensionAPI) => {
		let selfName: string | undefined;
		let cachedSelf: AgentRecord | undefined;

		// ── Registry helpers ────────────────────────────────────

		function getSelfRecord(): AgentRecord | undefined {
			if (cachedSelf) return cachedSelf;
			const record = readAllAgentRecords().find((r) => r.pid === process.pid);
			if (record) cachedSelf = record;
			return record;
		}

		function getSelfName(): string {
			if (!selfName) selfName = getSelfRecord()?.name ?? "unknown";
			return selfName;
		}

		/** Update pendingMessages in this agent's record. */
		function updatePendingCount(): void {
			const self = getSelfRecord();
			if (!self) return;
			const count = config.send.pendingCount(self.id);
			if (self.pendingMessages !== count) {
				self.pendingMessages = count;
				writeAgentRecord(self);
				cachedSelf = self; // keep cache in sync
			}
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
			return ok(
				`No agent named "${name}". Known peers: ${peerNames()}`,
				{ name, error: "not_found" },
			);
		}

		// ── Inbox draining ─────────────────────────────────────

		function drainInbox(): void {
			const selfId = getSelfRecord()?.id;
			if (!selfId) return;
			const pending = config.send.receive(selfId);
			for (const msg of pending) {
				try {
					pi.sendUserMessage(`[from ${msg.from}]: ${msg.text}`, { deliverAs: "followUp" });
				} catch {
					continue;
				}
				config.send.ack(selfId, msg.id);
			}
			if (pending.length > 0) config.send.prune(selfId);
			// Update pending count after draining
			updatePendingCount();
		}

		pi.on("session_start", async () => {
			// Eagerly cache self-record; downstream helpers skip the PID scan
			cachedSelf = readAllAgentRecords().find((r) => r.pid === process.pid);
			if (cachedSelf) {
				config.send.init(cachedSelf.id);
				updatePendingCount();
				drainInbox();
			}
		});

		pi.on("agent_end", async () => drainInbox());

		// ── /send command ──────────────────────────────────────

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
				const d = await config.send.send(peer, getSelfName(), msg);
				if (d.accepted) {
					ctx.ui.notify(`→ ${peerName}: ${preview}`, "info");
				} else {
					ctx.ui.notify(`Failed to send to "${peerName}": ${d.error}`, "error");
				}
			},
		});

		// ── agent_send tool ────────────────────────────────────

		pi.registerTool({
			name: "agent_send",
			label: "Agent Send",
			description:
				"Send a message to a named peer agent. Resolves the name from the registry " +
				"and delivers via the configured transport. " +
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
				const d = await config.send.send(peer, from, params.message);

				if (!d.accepted) return ok(
					`Failed to send to "${params.name}": ${d.error}`,
					{ name: params.name, error: d.error },
				);
				return ok(
					`Sent to ${params.name}: ${preview}`,
					{ name: params.name, messageLength: params.message.length, immediate: d.immediate, reference: d.reference },
				);
			},
		});

		// ── agent_broadcast tool ───────────────────────────────

		pi.registerTool({
			name: "agent_broadcast",
			label: "Agent Broadcast",
			description:
				"Broadcast a message to all registered agents (or a filtered subset). " +
				"Each agent receives the message via the configured broadcast transport.",
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
					return ok(
						params.filter ? `No agents matching "${params.filter}".` : "No peer agents registered.",
						{ sent: 0 },
					);
				}

				const from = getSelfName();
				const results: { name: string; ok: boolean; error?: string }[] = [];

				for (const target of targets) {
					const d = await config.broadcast.send(target, from, params.message);
					results.push({ name: target.name, ok: d.accepted, error: d.error });
				}

				const sent = results.filter((r) => r.ok).length;
				const summary = results
					.map((r) => `  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? ` (${r.error})` : ""}`)
					.join("\n");

				return ok(
					`Broadcast to ${targets.length} agent(s), ${sent} accepted:\n${summary}`,
					{ sent, failed: results.length - sent, targets: targets.map((t) => t.name) },
				);
			},
		});
	};
}

// Default: maildir for both (at-least-once everywhere)
const maildir = createMaildirTransport();
export default createMessagingExtension({ send: maildir, broadcast: maildir });
