/**
 * MatrixTransport — MessageTransport implementation backed by Matrix.
 *
 * Inbound messages are buffered in-memory (pushed via onInbound).
 * receive() returns and clears the buffer. ack/prune are no-ops
 * since the buffer is ephemeral.
 */

import type { AgentRecord } from "../../lib/agent-registry.js";
import type {
	DeliveryResult,
	InboundMessage,
	MessageTransport,
} from "../../lib/message-transport.js";
import type { MatrixBridgeClient, InboundMessage as MatrixInboundMessage } from "./client.js";
import { mxidLocalpart } from "./bridge.js";

const MAX_BUFFER = 200;

export class MatrixTransport implements MessageTransport {
	private buffer: InboundMessage[] = [];
	private channelLabel: string;
	private client: MatrixBridgeClient;

	constructor(client: MatrixBridgeClient, channelLabel = "matrix") {
		this.client = client;
		this.channelLabel = channelLabel;
	}

	/** Push a Matrix inbound message into the buffer. Called from the sync loop handler. */
	pushInbound(msg: MatrixInboundMessage): void {
		if (this.buffer.length >= MAX_BUFFER) this.buffer.shift();
		this.buffer.push({
			id: msg.eventId,
			from: `${this.channelLabel}:${mxidLocalpart(msg.senderMxid)}`,
			text: msg.body,
			ts: msg.timestampMs,
		});
	}

	async send(_peer: AgentRecord, _from: string, message: string): Promise<DeliveryResult> {
		try {
			const { eventId } = await this.client.send(message);
			return { accepted: true, immediate: true, reference: eventId };
		} catch (err) {
			return { accepted: false, immediate: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	receive(_agentId: string): InboundMessage[] {
		const messages = [...this.buffer];
		this.buffer.length = 0;
		return messages;
	}

	ack(_agentId: string, _messageId: string): void { /* no-op: in-memory buffer */ }
	prune(_agentId: string): void { /* no-op */ }
	init(_agentId: string): void { /* no-op: client lifecycle handled by extension */ }
	pendingCount(_agentId: string): number { return this.buffer.length; }
	cleanup(_agentId: string): void { /* no-op */ }
}
