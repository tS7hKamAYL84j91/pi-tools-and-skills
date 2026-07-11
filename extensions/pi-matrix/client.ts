/**
 * Matrix extension — Matrix bridge client.
 *
 * Orchestrates a MatrixClientAdapter implementation for headless bot use:
 *   - Accepts room invites from trusted senders
 *   - Filters own messages to prevent send/receive loops
 *   - Surfaces text and media m.room.message events to a user-supplied handler
 *
 * The underlying SDK is selected by constructing the desired adapter; this
 * file depends only on the adapter interface.
 */

import type { InboundAttachment } from "../../lib/message-transport.js";
import type {
	MatrixClientAdapter,
	MatrixInboundEvent,
	MatrixMembershipEvent,
} from "./adapter.js";
import { extractMatrixAttachment, isMatrixMediaMsgtype } from "./attachments.js";
import type { MatrixRoomMessageEvent } from "./attachments.js";
import { markdownToMatrixContent } from "./markdown.js";
import type { MatrixConfig } from "./types.js";

// ── Public types ────────────────────────────────────────────────

export interface InboundMessage {
	roomId: string;
	senderMxid: string;
	body: string;
	eventId: string;
	timestampMs: number;
	attachments?: InboundAttachment[];
}

type InboundHandler = (msg: InboundMessage) => void | Promise<void>;
type NotifyFn = (msg: string, level: "info" | "warning" | "error") => void;

export function isTrustedMatrixSender(config: MatrixConfig, sender?: string): sender is string {
	if (!sender) return false;
	if (sender === config.userId) return false;
	if (config.allowAnySender) return true;
	return config.trustedSenders.includes(sender);
}

export function shouldJoinMatrixInvite(config: MatrixConfig, roomId: string, sender?: string): boolean {
	if (config.roomId && roomId === config.roomId) return true;
	return isTrustedMatrixSender(config, sender);
}

// ── Client wrapper ──────────────────────────────────────────────

export class MatrixBridgeClient {
	private connected = false;
	private onInbound?: InboundHandler;
	private notifyFn?: NotifyFn;
	private seenEventIds = new Set<string>();

	constructor(
		private config: MatrixConfig,
		private adapter: MatrixClientAdapter,
	) {}

	/**
	 * Start the adapter and begin processing inbound events.
	 * Throws if the access token is rejected or the homeserver is unreachable.
	 */
	async start(onInbound: InboundHandler, notify?: NotifyFn): Promise<void> {
		this.onInbound = onInbound;
		this.notifyFn = notify;

		await this.adapter.start(this.config, {
			onMembership: (event) => this.handleMembership(event),
			onMessage: (event) => this.handleMessage(event),
			onLog: (message, level) => this.notifyFn?.(message, level),
			onConnectionChange: (connected) => {
				this.connected = connected;
			},
		});
		this.connected = this.adapter.isConnected();

		// Ensure we've joined the configured room when one is configured.
		if (this.config.roomId) {
			try {
				await this.adapter.joinRoom(this.config.roomId);
			} catch {
				/* non-fatal — invite may arrive later */
			}
		}
	}

	private async handleMembership(event: MatrixMembershipEvent): Promise<void> {
		if (event.membership !== "invite") return;
		const roomId = event.roomId;
		const sender = event.sender;
		if (shouldJoinMatrixInvite(this.config, roomId, sender)) {
			this.notifyFn?.(`joining invite from ${sender ?? "unknown sender"} (room ${roomId})`, "info");
			try {
				await this.adapter.joinRoom(roomId);
			} catch {
				/* non-fatal */
			}
			return;
		}
		try {
			await this.adapter.leaveRoom(roomId);
		} catch {
			/* non-fatal */
		}
	}

	private async handleMessage(event: MatrixInboundEvent): Promise<void> {
		if (event.isHistorical || event.isLocalEcho) return;
		if (this.seenEventIds.has(event.eventId)) return;
		this.seenEventIds.add(event.eventId);

		const msg = await this.buildInboundMessage(event);
		if (!msg) return;
		try {
			await this.onInbound?.(msg);
		} catch {
			/* non-fatal */
		}
	}

	private async buildInboundMessage(event: MatrixInboundEvent): Promise<InboundMessage | null> {
		const sender = event.sender;
		if (!isTrustedMatrixSender(this.config, sender)) return null;

		const content = event.content;
		const msgtype = content?.msgtype;
		if (!content || typeof msgtype !== "string") return null;

		const isTextLike = msgtype === "m.text" || msgtype === "m.notice" || msgtype === "m.emote";
		const rawEvent: MatrixRoomMessageEvent = {
			sender,
			event_id: event.eventId,
			origin_server_ts: event.timestampMs,
			content,
		};
		const attachments = isMatrixMediaMsgtype(msgtype)
			? [await extractMatrixAttachment(this.config, this.adapter, event.roomId, rawEvent)]
					.filter((attachment): attachment is InboundAttachment => attachment !== null)
			: [];
		if (!isTextLike && attachments.length === 0) return null;

		const body = typeof content.body === "string" && content.body.length > 0
			? content.body
			: attachments.length > 0
				? `[${msgtype} attachment]`
				: "";
		if (!body && attachments.length === 0) return null;

		return {
			roomId: event.roomId,
			senderMxid: sender,
			body,
			eventId: event.eventId,
			timestampMs: event.timestampMs,
			attachments: attachments.length > 0 ? attachments : undefined,
		};
	}

	/** Send a text message to the configured room. */
	async send(text: string): Promise<{ eventId: string }> {
		if (!this.config.roomId) {
			throw new Error("Matrix room is not configured yet; send the bot a DM first.");
		}
		return this.sendTo(this.config.roomId, text);
	}

	/** Send a text message to an explicit Matrix room. */
	async sendTo(roomId: string, text: string): Promise<{ eventId: string }> {
		return this.adapter.sendMessage(roomId, markdownToMatrixContent(text));
	}

	async stop(): Promise<void> {
		await this.adapter.stop();
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}
}
