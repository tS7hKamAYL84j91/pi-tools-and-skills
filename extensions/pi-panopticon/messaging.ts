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

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { onAgentCleanup, REGISTRY_DIR } from "../../lib/agent-registry.js";
import type { InboundMessage, MessageTransport } from "../../lib/message-transport.js";
import { getChannels } from "../../lib/message-transport.js";
import type { Registry } from "./types.js";
import { ok, fail } from "./types.js";
import { getSelfName, resolvePeer, peerNames, notFound } from "./peers.js";

// ── Pure helpers ────────────────────────────────────────────────

function truncate(s: string, max = 200): string {
	return s.length <= max ? s : `${s.slice(0, max)}\u2026`;
}

// ── Config ──────────────────────────────────────────────────────

interface MessagingConfig {
	/** Transport for point-to-point sends (agent_send, /send). */
	send: MessageTransport;
	/** Transport for broadcast (agent_broadcast). */
	broadcast: MessageTransport;
	/** Called for each inbound agent-channel message (e.g. completion-signal parsing). */
	onMessage?: (text: string) => void;
}

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
		let extensionCtx: ExtensionContext | null = null;
		let pokeTimeout: ReturnType<typeof setTimeout> | null = null;
		let disposeCleanupHook: (() => void) | null = null;
		let inboxWatcher: FSWatcher | null = null;

		// ── Poke logic (debounced, idle-gated) ─────────────────

		function totalPending(): number {
			const record = registry.getRecord();
			if (!record) return 0;
			let count = 0;
			for (const [, transport] of getChannels()) {
				count += transport.pendingCount(record.id);
			}
			return count;
		}

		function schedulePoke(): void {
			if (pokeTimeout) return;
			pokeTimeout = setTimeout(() => {
				pokeTimeout = null;
				const count = totalPending();
				if (count === 0) return;
				if (!extensionCtx?.isIdle()) {
					schedulePoke();
					return;
				}
				pi.sendUserMessage(
					`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
					{ deliverAs: "followUp" },
				);
			}, 2000);
		}

		function pokeNow(): void {
			const count = totalPending();
			if (count === 0) return;
			if (pokeTimeout) { clearTimeout(pokeTimeout); pokeTimeout = null; }
			pi.sendUserMessage(
				`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
				{ deliverAs: "followUp" },
			);
		}

		// ── Drain all channels ─────────────────────────────────

		interface ChannelMessage extends InboundMessage {
			channel: string;
		}

		function drainAllChannels(): ChannelMessage[] {
			const record = registry.getRecord();
			if (!record) return [];
			const all: ChannelMessage[] = [];
			for (const [name, transport] of getChannels()) {
				const pending = transport.receive(record.id);
				for (const msg of pending) {
					all.push({ ...msg, channel: name });
					if (name === "agent") config.onMessage?.(msg.text);
					transport.ack(record.id, msg.id);
				}
				if (pending.length > 0) transport.prune(record.id);
			}
			return all;
		}

		function updatePendingCount(): void {
			const record = registry.getRecord();
			if (!record) return;
			const count = totalPending();
			if (record.pendingMessages !== count) {
				registry.updatePendingMessages(count);
			}
		}

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
				const messages = drainAllChannels();
				updatePendingCount();
				if (messages.length === 0) {
					return ok("No unread messages.", { count: 0, messages: [] });
				}
				const lines = messages.map((m) => {
					const time = new Date(m.ts).toLocaleTimeString("en-GB", { hour12: false });
					return `[${time}] [${m.channel}:${m.from}] ${m.text}`;
				});
				return ok(
					`<external-messages>\n${lines.join("\n")}\n</external-messages>`,
					{ count: messages.length, channels: [...new Set(messages.map((m) => m.channel))] },
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
				const transport = getChannels().get(params.channel);
				if (!transport) {
					const available = [...getChannels().keys()].filter((c) => c !== "agent").join(", ");
					return fail(`Unknown channel "${params.channel}". Available: ${available || "(none)"}`);
				}
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
				const peers = registry.readAllPeers().filter((r) => !self || r.id !== self.id);
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
				extensionCtx = ctx;
				const record = registry.getRecord();
				if (!record) return;
				config.send.init(record.id);
				updatePendingCount();
				// Drain any messages already pending at startup
				if (totalPending() > 0) pokeNow();
				// Register transport cleanup for dead-agent reaping
				disposeCleanupHook?.();
				disposeCleanupHook = onAgentCleanup((agentId) => config.send.cleanup(agentId));
				// Watch inbox for new messages — triggers debounced poke
				inboxWatcher?.close();
				try {
					const newDir = join(REGISTRY_DIR, record.id, "inbox", "new");
					inboxWatcher = watch(newDir, () => schedulePoke());
					inboxWatcher.unref();
				} catch { /* best-effort: dir may not exist yet */ }
			},
			pokePending() {
				pokeNow();
			},
			drainAll() {
				const messages = drainAllChannels();
				if (messages.length > 0) {
					const lines = messages.map((m) => {
						const time = new Date(m.ts).toLocaleTimeString("en-GB", { hour12: false });
						return `[${time}] [${m.channel}:${m.from}] ${m.text}`;
					});
					try {
						pi.sendUserMessage(
							`<external-messages>\n${lines.join("\n")}\n</external-messages>`,
							{ deliverAs: "followUp" },
						);
					} catch { /* shutdown — best-effort */ }
				}
				updatePendingCount();
			},
			dispose() {
				if (pokeTimeout) { clearTimeout(pokeTimeout); pokeTimeout = null; }
				inboxWatcher?.close();
				inboxWatcher = null;
				disposeCleanupHook?.();
				disposeCleanupHook = null;
			},
		};

		return module;
	};
}
