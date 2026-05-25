/**
 * Pi Agents Messaging — Unified multi-channel messaging with poke-then-read.
 *
 * All messaging channels (agent Maildir, Matrix, etc.) register via the
 * channel registry in lib/message-transport.ts. This module provides:
 *
 * - Debounced, idle-gated notification ("N new messages — use message_read")
 * - message_read tool: drains all channels, returns wrapped content
 * - message_send tool: routes to the correct channel
 * - agent_send / agent_broadcast: convenience tools for agent-to-agent
 * - /send command
 *
 * The notification pattern is extracted from the Matrix extension:
 * poke with count only (no bodies) → agent calls message_read when ready.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { onAgentCleanup } from "../../lib/agent-registry.js";
import type { InboundAttachment } from "../../lib/message-transport.js";
import { getChannel, getChannels, onChannelNotify } from "../../lib/message-transport.js";
import type { Registry } from "./types.js";
import { ok, fail } from "./types.js";
import { getSelfName, resolvePeer, peerNames, notFound } from "./peers.js";
import { visibleRecords } from "./visibility.js";
import { MessagingCore, type ChannelMessage } from "./messaging-core.js";

// ── Pure helpers ────────────────────────────────────────────────

function truncate(s: string, max = 200): string {
	return s.length <= max ? s : `${s.slice(0, max)}\u2026`;
}

function formatAttachment(a: InboundAttachment): string {
	const fields = [
		`attachment:${a.kind}`,
		`filename=${JSON.stringify(a.filename)}`,
		a.mimeType ? `mime=${JSON.stringify(a.mimeType)}` : undefined,
		a.sizeBytes !== undefined ? `size=${a.sizeBytes}` : undefined,
		a.localPath ? `path=${JSON.stringify(a.localPath)}` : undefined,
		a.mxcUrl ? `mxc=${JSON.stringify(a.mxcUrl)}` : undefined,
		`event=${JSON.stringify(a.eventId)}`,
		a.roomId ? `room=${JSON.stringify(a.roomId)}` : undefined,
		a.encrypted ? "encrypted=true" : undefined,
		a.error ? `error=${JSON.stringify(a.error)}` : undefined,
	].filter((field): field is string => field !== undefined);
	return `  - ${fields.join(" ")}`;
}

function formatChannelMessage(m: ChannelMessage): string {
	const time = new Date(m.ts).toLocaleTimeString("en-GB", { hour12: false });
	const firstLine = `[${time}] [${m.channel}:${m.from}] ${m.text}`;
	const attachments = m.attachments?.map(formatAttachment) ?? [];
	return attachments.length > 0 ? `${firstLine}\n${attachments.join("\n")}` : firstLine;
}

function messageDetails(messages: ChannelMessage[]): Record<string, unknown> {
	return {
		count: messages.length,
		channels: [...new Set(messages.map((m) => m.channel))],
		messages: messages.map((m) => ({
			channel: m.channel,
			id: m.id,
			from: m.from,
			text: m.text,
			ts: m.ts,
			attachments: m.attachments ?? [],
		})),
	};
}

// ── Config ──────────────────────────────────────────────────────

import type { MessagingConfig } from "./messaging-config.js";

// ── Messaging Module ────────────────────────────────────────────

interface MessagingModule {
	/** Initialize transport, drain inbox, register cleanup hook, start watcher. */
	init(ctx: ExtensionContext): void;
	/** Poke immediately if messages are pending (bypass debounce). */
	pokePending(): void;
	/** Drain all channels directly — for shutdown (no poke, just process). */
	drainAll(): void;
	/** Remove cleanup hooks and watchers. */
	dispose(): void;
}

// ── Factory ─────────────────────────────────────────────────────

export function createMessaging(config: MessagingConfig) {
	return function setup(pi: ExtensionAPI, registry: Registry): MessagingModule {
		let disposeCleanupHook: (() => void) | null = null;
		const core = new MessagingCore(pi, registry, config);

		// ── message_read tool ──────────────────────────────────

		pi.registerTool({
			name: "message_read",
			label: "Read Messages",
			description:
				"Read all unread messages across messaging channels (agents, Matrix, etc.). " +
				"Returns messages received since the last read. " +
				"Call this when you receive a new-messages notification.",
			promptSnippet: "Read unread messages from all channels",
			promptGuidelines: [
				"Call message_read when notified of new messages — don't ignore the notification.",
				"After reading, reply via message_send or agent_send as appropriate.",
			],
			parameters: Type.Object({}),
			async execute() {
				const messages = core.drainAllChannels();
				core.updatePendingCount();
				if (messages.length === 0) {
					return ok("No unread messages.", { count: 0, messages: [] });
				}
				const lines = messages.map(formatChannelMessage);
				return ok(
					`<external-messages>\n${lines.join("\n")}\n</external-messages>`,
					messageDetails(messages),
				);
			},
		});

		// ── message_send tool ──────────────────────────────────

		pi.registerTool({
			name: "message_send",
			label: "Send Message",
			description:
				"Send a message via a named channel (e.g. 'matrix'). " +
				"For agent-to-agent messages, use agent_send instead.",
			promptSnippet: "Send a message via a named channel",
			parameters: Type.Object({
				channel: Type.String({ description: 'Channel name (e.g. "matrix")' }),
				message: Type.String({ description: "Message body" }),
			}),
			async execute(_id, params) {
				if (!getChannels().has(params.channel)) {
					const available = [...getChannels().keys()].filter((c) => c !== "agent").join(", ");
					return fail(`Unknown channel "${params.channel}". Available: ${available || "(none)"}`);
				}
				const transport = getChannel(params.channel);
				const stub = { id: "", name: "", pid: 0, cwd: "", model: "", startedAt: 0, heartbeat: 0, status: "running" as const };
				const d = await transport.send(stub, getSelfName(registry), params.message);
				if (!d.accepted) return fail(`Send failed: ${d.error}`);
				return ok(`Sent via ${params.channel}.`, { channel: params.channel, reference: d.reference });
			},
		});

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
				const peer = resolvePeer(registry, peerName);
				if (!peer) {
					ctx.ui.notify(`No agent named "${peerName}". Peers: ${peerNames(registry)}`, "warning");
					return;
				}
				const preview = truncate(msg, 50);
				const d = await config.send.send(peer, getSelfName(registry), msg);
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

			async execute(_id, params) {
				const peer = resolvePeer(registry, params.name);
				if (!peer) return notFound(registry, params.name);

				const from = getSelfName(registry);
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

			async execute(_id, params) {
				const self = registry.getRecord();
				const peers = visibleRecords(self, registry.readAllPeers()).filter((r) => !self || r.id !== self.id);
				const targets = params.filter
					? peers.filter((r) => r.name.toLowerCase().includes(params.filter?.toLowerCase() ?? ""))
					: peers;

				if (targets.length === 0) {
					return ok(
						params.filter ? `No agents matching "${params.filter}".` : "No peer agents registered.",
						{ sent: 0 },
					);
				}

				const from = getSelfName(registry);
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

		// ── Return MessagingModule ──────────────────────────────

		const module: MessagingModule = {
			init(ctx) {
				core.setContext(ctx);
				const record = registry.getRecord();
				if (!record) return;
				config.send.init(record.id);
				core.updatePendingCount();
				// Drain any messages already pending at startup
				if (core.totalPending() > 0) core.pokeNow();
				// Register as the channel notification handler — any channel
				// (Matrix, future channels) calls notifyChannel() to trigger poke
				onChannelNotify(() => core.schedulePoke());
				// Register transport cleanup for dead-agent reaping
				disposeCleanupHook?.();
				disposeCleanupHook = onAgentCleanup((agentId) => config.send.cleanup(agentId));
				// Watch Maildir inbox for new messages — triggers debounced poke
				core.startWatcher();
			},
			pokePending() {
				core.pokeNow();
			},
			drainAll() {
				const messages = core.drainAllChannels();
				if (messages.length > 0) {
					const lines = messages.map(formatChannelMessage);
					try {
						pi.sendUserMessage(
							`<external-messages>\n${lines.join("\n")}\n</external-messages>`,
							{ deliverAs: "followUp" },
						);
					} catch { /* shutdown — best-effort */ }
				}
				core.updatePendingCount();
			},
			dispose() {
				core.dispose();
				disposeCleanupHook?.();
				disposeCleanupHook = null;
			},
		};

		return module;
	};
}
