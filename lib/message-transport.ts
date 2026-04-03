/**
 * MessageTransport — Dependency Inversion boundary for agent messaging.
 *
 * All messaging code depends on this interface, never on concrete
 * transports (Maildir, sockets, Redis, HTTP…).  Swap implementations
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

/** A message waiting to be consumed on the receive side. */
export interface InboundMessage {
	/** Opaque identifier — pass back to `ack()` after processing. */
	id: string;
	from: string;
	text: string;
	ts: number;
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
