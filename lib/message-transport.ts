/**
 * MessageTransport — Dependency Inversion boundary for agent messaging.
 *
 * All messaging code depends on this interface, never on concrete
 * transports (Maildir, Redis, HTTP…).  Swap implementations
 * without touching the business logic.
 *
 * The transport determines the delivery semantics (at-least-once,
 * at-most-once, etc.) — callers just call send().
 */

import type { AgentRecord } from "./agent-registry.js";

// ── Result types ────────────────────────────────────────────────

/** Transport-agnostic outcome of a send. */
export interface DeliveryResult {
	/** Transport accepted the message (it will be delivered). */
	accepted: boolean;
	/** Recipient received it right now. */
	immediate: boolean;
	/** Transport-specific tracking reference (e.g. filename, message-id). */
	reference?: string;
	/** Human-readable error when not accepted. */
	error?: string;
}

/** Downloaded or skipped attachment metadata carried by inbound messages. */
export interface InboundAttachment {
	kind: "image" | "file" | "audio" | "video";
	filename: string;
	mimeType?: string;
	sizeBytes?: number;
	localPath?: string;
	mxcUrl?: string;
	eventId: string;
	roomId?: string;
	senderMxid?: string;
	timestampMs?: number;
	encrypted?: boolean;
	error?: string;
}

/** A message waiting to be consumed on the receive side. */
export interface InboundMessage {
	/** Opaque identifier — pass back to `ack()` after processing. */
	id: string;
	from: string;
	/** Canonical sender registry ID when supplied by the native caller; not proof of authentication. */
	senderId?: string;
	text: string;
	ts: number;
	attachments?: InboundAttachment[];
}

// ── The interface ───────────────────────────────────────────────

export interface MessageTransport {
	/** Send a message to a peer agent. */
	send(
		peer: AgentRecord,
		from: string,
		message: string,
		senderId?: string,
	): Promise<DeliveryResult>;

	/** Return all pending inbound messages for `agentId`, oldest first. */
	receive(agentId: string, mailboxPath?: string): InboundMessage[];

	/** Mark a received message as processed. */
	ack(agentId: string, messageId: string, mailboxPath?: string): void;

	/** Remove old acknowledged messages (housekeeping). */
	prune(agentId: string, mailboxPath?: string): void;

	/** Ensure the transport is ready for the given agent (create queues, dirs, etc.). */
	init(agentId: string): void;

	/** Return the number of pending inbound messages for `agentId`. */
	pendingCount(agentId: string, mailboxPath?: string): number;

	/** Remove all transport storage for a dead agent (inbox dirs, queues, etc.). */
	cleanup(agentId: string): void;
}

// ── Global Scope Types ─────────────────────────────────────────

declare global {
	var __pi_messaging_channels__: Map<string, MessageTransport> | undefined;
	var __pi_channel_notify__: (() => void) | undefined;
}

// ── Channel registry ───────────────────────────────────────────
/**
 * Uses globalThis so the registry is shared across extension module
 * contexts. Pi may load each extension in a separate module scope,
 * which would give each its own module-level Map — breaking the
 * singleton pattern. `globalThis` ensures exactly one registry exists
 * process-wide, mitigating the risk of segmented module caches.
 */
function getChannelMap(): Map<string, MessageTransport> {
	if (!globalThis.__pi_messaging_channels__) {
		globalThis.__pi_messaging_channels__ = new Map<string, MessageTransport>();
		// Diagnostic: trace who initialized the global registry
		// console.debug("[MessageTransport] Initialized globalThis channel registry.");
	}
	return globalThis.__pi_messaging_channels__;
}

/** Register a named messaging channel (e.g. "agent", "matrix"). */
export function registerChannel(name: string, transport: MessageTransport): void {
	getChannelMap().set(name, transport);
}

/** Unregister a messaging channel. */
export function unregisterChannel(name: string): void {
	getChannelMap().delete(name);
}

/** Get all registered channels. */
export function getChannels(): ReadonlyMap<string, MessageTransport> {
	return getChannelMap();
}

/**
 * Get a specific channel by name, with an explicit fallback if missing.
 * This mitigates risks of missed registrations or loading order issues
 * by returning a diagnostic dummy transport instead of crashing.
 */
export function getChannel(name: string): MessageTransport {
	const transport = getChannelMap().get(name);
	if (transport) return transport;

	// Explicit fallback for missing transports
	console.warn(`[MessageTransport] WARNING: Channel "${name}" requested but not registered. Returning fallback transport.`);
	return {
		send: async () => ({
			accepted: false,
			immediate: false,
			error: `Channel ${name} is not registered. (Is the extension loaded?)`,
		}),
		receive: () => [],
		ack: () => {},
		prune: () => {},
		init: () => {},
		pendingCount: () => 0,
		cleanup: () => {},
	};
}

// ── Channel notification ───────────────────────────────────────
// Channels call notifyChannel() when they have new messages.
// The messaging module registers a listener via onChannelNotify().

type ChannelNotifyFn = () => void;

function getNotifyFn(): ChannelNotifyFn | undefined {
	return globalThis.__pi_channel_notify__;
}

/** Register a poke trigger. The disposer clears it only when still current. */
export function onChannelNotify(fn: ChannelNotifyFn): () => void {
	globalThis.__pi_channel_notify__ = fn;
	return () => {
		if (globalThis.__pi_channel_notify__ === fn) {
			globalThis.__pi_channel_notify__ = undefined;
		}
	};
}

/** Called by any channel when new messages are available. Triggers the poke system. */
export function notifyChannel(): void {
	getNotifyFn()?.();
}
