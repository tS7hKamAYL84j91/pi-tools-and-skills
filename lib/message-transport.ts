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
	): Promise<DeliveryResult>;

	/** Return all pending inbound messages for `agentId`, oldest first. */
	receive(agentId: string): InboundMessage[];

	/** Mark a received message as processed. */
	ack(agentId: string, messageId: string): void;

	/** Remove old acknowledged messages (housekeeping). */
	prune(agentId: string): void;

	/** Ensure the transport is ready for the given agent (create queues, dirs, etc.). */
	init(agentId: string): void;

	/** Return the number of pending inbound messages for `agentId`. */
	pendingCount(agentId: string): number;

	/** Remove all transport storage for a dead agent (inbox dirs, queues, etc.). */
	cleanup(agentId: string): void;
}

// ── Channel registry ───────────────────────────────────────────
/**
 * Uses globalThis so the registry is shared across extension module
 * contexts. Pi may load each extension in a separate module scope,
 * which would give each its own module-level Map — breaking the
 * singleton pattern. `globalThis` ensures exactly one registry exists
 * process-wide, mitigating the risk of segmented module caches.
 */
const CHANNEL_KEY = "__pi_messaging_channels__";

function getChannelMap(): Map<string, MessageTransport> {
	// biome-ignore lint/suspicious/noExplicitAny: globalThis registry for cross-module sharing
	const g = globalThis as any;
	if (!g[CHANNEL_KEY]) {
		g[CHANNEL_KEY] = new Map<string, MessageTransport>();
	}
	return g[CHANNEL_KEY] as Map<string, MessageTransport>;
}

/** Register a named messaging channel (e.g. "agent", "matrix"). */
export function registerChannel(
	name: string,
	transport: MessageTransport,
): void {
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
	console.warn(
		`[MessageTransport] WARNING: Channel "${name}" requested but not registered. Returning fallback transport.`,
	);
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

const NOTIFY_KEY = "__pi_channel_notify__";

type ChannelNotifyFn = () => void;

function getNotifyFn(): ChannelNotifyFn | undefined {
	// biome-ignore lint/suspicious/noExplicitAny: globalThis for cross-module sharing
	return (globalThis as any)[NOTIFY_KEY] as ChannelNotifyFn | undefined;
}

/** Register a poke trigger. The disposer clears it only when still current. */
export function onChannelNotify(fn: ChannelNotifyFn): () => void {
	// biome-ignore lint/suspicious/noExplicitAny: globalThis for cross-module sharing
	const globalState = globalThis as any;
	globalState[NOTIFY_KEY] = fn;
	return () => {
		if (globalState[NOTIFY_KEY] === fn) {
			delete globalState[NOTIFY_KEY];
		}
	};
}

/** Called by any channel when new messages are available. Triggers the poke system. */
export function notifyChannel(): void {
	getNotifyFn()?.();
}
