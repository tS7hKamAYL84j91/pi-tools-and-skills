/**
 * MatrixTransport — MessageTransport implementation backed by Matrix.
 *
 * Inbound messages are buffered in-memory (pushed via onInbound).
 * receive() returns and clears the buffer. ack/prune are no-ops
 * since the buffer is ephemeral.
 *
 * Buffer overflow and per-sender/global ingress floods are bounded:
 * dropped messages increment redacted counters and emit a visible
 * diagnostic instead of silently discarding content.
 */

import type { AgentRecord } from "../../lib/agent-registry.js";
import type {
	DeliveryResult,
	InboundMessage,
	MessageTransport,
} from "../../lib/message-transport.js";
import type { MatrixBridgeClient, InboundMessage as MatrixInboundMessage } from "./client.js";
import type { MatrixIngressConfig } from "./types.js";
import { mxidLocalpart } from "./bridge.js";

const DEFAULT_INGRESS: Required<MatrixIngressConfig> = {
	maxBuffer: 200,
	globalBurstLimit: 1000,
	perSenderBurstLimit: 100,
	rateWindowMs: 10_000,
	overflowPolicy: "drop-newest",
};

/** Normalise optional ingress settings into a complete policy. */
function resolveIngressPolicy(policy?: MatrixIngressConfig): Required<MatrixIngressConfig> {
	return {
		maxBuffer: policy?.maxBuffer ?? DEFAULT_INGRESS.maxBuffer,
		globalBurstLimit: policy?.globalBurstLimit ?? DEFAULT_INGRESS.globalBurstLimit,
		perSenderBurstLimit: policy?.perSenderBurstLimit ?? DEFAULT_INGRESS.perSenderBurstLimit,
		rateWindowMs: policy?.rateWindowMs ?? DEFAULT_INGRESS.rateWindowMs,
		overflowPolicy: policy?.overflowPolicy ?? DEFAULT_INGRESS.overflowPolicy,
	};
}

interface IngressCounters {
	accepted: number;
	droppedGlobal: number;
	droppedSender: number;
	overflowed: number;
	totalDropped: number;
}

/**
 * Sliding-window ingress limiter. Tracks per-sender and global bursts,
 * records dropped messages by cause, and emits redacted diagnostics.
 */
class MatrixIngressLimiter {
	private acceptedCount = 0;
	private droppedGlobalCount = 0;
	private droppedSenderCount = 0;
	private overflowCount = 0;
	private globalWindow: number[] = [];
	private senderWindows = new Map<string, number[]>();
	private pendingDiagnostic: string | null = null;

	constructor(
		private policy: Required<MatrixIngressConfig>,
		private onDiagnostic?: (message: string) => void,
	) {}

	/** Accept or drop a single inbound message. */
	tryAccept(sender: string, nowMs = Date.now()): boolean {
		this.prune(nowMs);

		if (this.globalWindow.length >= this.policy.globalBurstLimit) {
			this.droppedGlobalCount++;
			this.emitDiagnostic("global rate limit exceeded");
			return false;
		}

		const senderWindow = this.senderWindows.get(sender) ?? [];
		if (senderWindow.length >= this.policy.perSenderBurstLimit) {
			this.droppedSenderCount++;
			this.emitDiagnostic("per-sender rate limit exceeded");
			return false;
		}

		this.globalWindow.push(nowMs);
		senderWindow.push(nowMs);
		this.senderWindows.set(sender, senderWindow);
		this.acceptedCount++;
		return true;
	}

	/** Record that a buffer-overflow policy caused a drop. */
	recordOverflow(): void {
		this.overflowCount++;
		this.emitDiagnostic(`buffer overflow (${this.policy.overflowPolicy})`);
	}

	counters(): IngressCounters {
		return {
			accepted: this.acceptedCount,
			droppedGlobal: this.droppedGlobalCount,
			droppedSender: this.droppedSenderCount,
			overflowed: this.overflowCount,
			totalDropped: this.droppedGlobalCount + this.droppedSenderCount + this.overflowCount,
		};
	}

	/** Flush any pending diagnostic through the callback and return the message. */
	flushDiagnostic(): string | null {
		const message = this.pendingDiagnostic;
		if (message) {
			this.pendingDiagnostic = null;
			this.onDiagnostic?.(message);
		}
		return message;
	}

	private prune(nowMs: number): void {
		const cutoff = nowMs - this.policy.rateWindowMs;
		this.globalWindow = this.globalWindow.filter((ts) => ts > cutoff);
		for (const [sender, window] of this.senderWindows) {
			const pruned = window.filter((ts) => ts > cutoff);
			if (pruned.length === 0) {
				this.senderWindows.delete(sender);
			} else {
				this.senderWindows.set(sender, pruned);
			}
		}
	}

	private emitDiagnostic(reason: string): void {
		const counters = this.counters();
		const message = `matrix ingress: dropped 1 message (${reason}); accepted ${counters.accepted}, total dropped ${counters.totalDropped}`;
		if (this.pendingDiagnostic === null) {
			this.onDiagnostic?.(message);
		}
		this.pendingDiagnostic = message;
	}
}

export class MatrixTransport implements MessageTransport {
	private buffer: InboundMessage[] = [];
	private channelLabel: string;
	private client: MatrixBridgeClient;
	private lastInboundRoomId: string | null = null;
	private limiter: MatrixIngressLimiter;
	private policy: Required<MatrixIngressConfig>;

	constructor(
		client: MatrixBridgeClient,
		channelLabel = "matrix",
		ingress: MatrixIngressConfig = {},
		onDiagnostic?: (message: string) => void,
	) {
		this.client = client;
		this.channelLabel = channelLabel;
		this.policy = resolveIngressPolicy(ingress);
		this.limiter = new MatrixIngressLimiter(this.policy, onDiagnostic);
	}

	/** Push a Matrix inbound message into the buffer. Called from the sync loop handler. */
	pushInbound(msg: MatrixInboundMessage): void {
		this.lastInboundRoomId = msg.roomId;
		if (!this.limiter.tryAccept(msg.senderMxid, msg.timestampMs)) {
			return;
		}

		if (this.buffer.length >= this.policy.maxBuffer) {
			this.limiter.recordOverflow();
			if (this.policy.overflowPolicy === "drop-newest") {
				return;
			}
			this.buffer.shift();
		}

		this.buffer.push({
			id: msg.eventId,
			from: `${this.channelLabel}:${mxidLocalpart(msg.senderMxid)}`,
			text: msg.body,
			ts: msg.timestampMs,
			attachments: msg.attachments,
		});
	}

	async send(_peer: AgentRecord, _from: string, message: string): Promise<DeliveryResult> {
		try {
			const { eventId } = this.lastInboundRoomId
				? await this.client.sendTo(this.lastInboundRoomId, message)
				: await this.client.send(message);
			return { accepted: true, immediate: true, reference: eventId };
		} catch (err) {
			return { accepted: false, immediate: false, error: err instanceof Error ? err.message : String(err) };
		}
	}

	receive(_agentId: string): InboundMessage[] {
		this.limiter.flushDiagnostic();
		const messages = [...this.buffer];
		this.buffer.length = 0;
		return messages;
	}

	ack(_agentId: string, _messageId: string): void { /* no-op: in-memory buffer */ }
	prune(_agentId: string): void { /* no-op */ }
	init(_agentId: string): void { /* no-op: client lifecycle handled by extension */ }
	pendingCount(_agentId: string): number { return this.buffer.length; }
	cleanup(_agentId: string): void { /* no-op */ }

	/** Exposed for tests. */
	limiterCounters(): IngressCounters {
		return this.limiter.counters();
	}
}
