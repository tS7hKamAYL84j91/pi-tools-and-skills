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
import { createAttachmentDownloadResources } from "./attachment-download.js";
import { markdownToMatrixContent } from "./markdown.js";
import { mentionsAgent } from "./mention.js";
import { BoundedRecentSet } from "./resource-bounds.js";
import type { AttachmentDownloadResources } from "./resource-bounds.js";
import type { MatrixConfig } from "./types.js";

const MAX_SEEN_EVENT_IDS = 10_000;

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

/**
 * Rooms this agent is allowed to receive from.
 *
 * A configured `roomId` is the agent's single delivery room: traffic from any
 * other room is dropped, because several agents may share one Matrix account.
 * Without a configured room (interactive DM bootstrap) any trusted sender room
 * is accepted.
 */
export function configuredRooms(config: MatrixConfig): string[] {
	return [config.roomId, config.sharedRoomId].filter(
		(room): room is string => typeof room === "string" && room.length > 0,
	);
}

export function isConfiguredRoom(config: MatrixConfig, roomId: string): boolean {
	const rooms = configuredRooms(config);
	return rooms.length === 0 || rooms.includes(roomId);
}

/** True when this message is in the shared room and mentions this agent. */
export function isAddressedToAgent(
	config: MatrixConfig,
	roomId: string,
	body: string,
): boolean {
	if (!config.sharedRoomId || roomId !== config.sharedRoomId) return true;
	return mentionsAgent(body, config.mentionNames ?? [], {
		all: config.mentionAll !== false,
	});
}

export function shouldJoinMatrixInvite(config: MatrixConfig, roomId: string, sender?: string): boolean {
	if (!isTrustedMatrixSender(config, sender)) return false;
	if (config.roomId) return roomId === config.roomId;
	return true;
}

// ── Client wrapper ──────────────────────────────────────────────

export class MatrixBridgeClient {
	private connected = false;
	private onInbound?: InboundHandler;
	private notifyFn?: NotifyFn;
	private readonly seenEventIds = new BoundedRecentSet(MAX_SEEN_EVENT_IDS);
	private readonly downloadResources: AttachmentDownloadResources;
	/** Most recent accepted inbound room; only used when no room is configured. */
	private lastInboundRoomId: string | null = null;
	private lifecycleController = new AbortController();

	constructor(
		private config: MatrixConfig,
		private adapter: MatrixClientAdapter,
	) {
		this.downloadResources = createAttachmentDownloadResources(config);
	}

	/**
	 * Start the adapter and begin processing inbound events.
	 * Throws if the access token is rejected or the homeserver is unreachable.
	 */
	async start(onInbound: InboundHandler, notify?: NotifyFn): Promise<void> {
		if (this.lifecycleController.signal.aborted) this.lifecycleController = new AbortController();
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

		// Ensure we've joined every configured room. Surface a failure: an agent
		// bound to a room it has not joined receives nothing there.
		for (const roomId of configuredRooms(this.config)) {
			try {
				await this.adapter.joinRoom(roomId);
			} catch (err) {
				this.notifyFn?.(
					`not joined to configured room ${roomId}: ${err instanceof Error ? err.message : String(err)}`,
					"warning",
				);
			}
		}
	}

	private async handleMembership(event: MatrixMembershipEvent): Promise<void> {
		if (event.membership !== "invite") return;
		const roomId = event.roomId;
		const sender = event.sender;

		// One Matrix account can back several room-bound agents, and this client's
		// leave/join are ACCOUNT-GLOBAL. A foreign invite belongs to another
		// agent's conversation: ignore it entirely — never join it, and never
		// leave/decline it, which would withdraw the invite or kick the owning
		// agent out of the room it is accepting.
		if (configuredRooms(this.config).length > 0 && !isConfiguredRoom(this.config, roomId)) {
			return;
		}

		if (configuredRooms(this.config).length > 0) {
			// Own room only; still require a trusted inviter. Ignoring (rather than
			// leaving) an untrusted invite cannot disturb shared account state.
			if (!isTrustedMatrixSender(this.config, sender)) return;
			this.notifyFn?.(`joining invite from ${sender ?? "unknown sender"} (room ${roomId})`, "info");
			try {
				await this.adapter.joinRoom(roomId);
			} catch {
				/* non-fatal — the invite can be accepted later */
			}
			return;
		}

		// Unbound bootstrap (one client for the account, e.g. Lumen): accept a
		// trusted DM/room invite, decline an untrusted one.
		if (isTrustedMatrixSender(this.config, sender)) {
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
		// Replies follow the room of the message being answered (private room or the
		// shared room), so a shared-room question is answered in the shared room.
		this.lastInboundRoomId = msg.roomId;
		try {
			await this.onInbound?.(msg);
		} catch {
			/* non-fatal */
		}
	}

	private async buildInboundMessage(event: MatrixInboundEvent): Promise<InboundMessage | null> {
		const sender = event.sender;
		if (!isTrustedMatrixSender(this.config, sender)) return null;
		// Delivery is bound to the configured rooms; other traffic on the shared
		// account belongs to another agent's conversation.
		if (!isConfiguredRoom(this.config, event.roomId)) return null;

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
			? [await extractMatrixAttachment({
					config: this.config,
					client: this.adapter,
					roomId: event.roomId,
					event: rawEvent,
					downloadResources: this.downloadResources,
					lifecycleSignal: this.lifecycleController.signal,
				})]
					.filter((attachment): attachment is InboundAttachment => attachment !== null)
			: [];
		if (!isTextLike && attachments.length === 0) return null;

		const body = typeof content.body === "string" && content.body.length > 0
			? content.body
			: attachments.length > 0
				? `[${msgtype} attachment]`
				: "";
		if (!body && attachments.length === 0) return null;

		// The shared room is mention-gated: an unmentioned message is dropped BEFORE
		// it reaches the transport, so it cannot notify, queue or wake this agent.
		if (!isAddressedToAgent(this.config, event.roomId, body)) return null;

		return {
			roomId: event.roomId,
			senderMxid: sender,
			body,
			eventId: event.eventId,
			timestampMs: event.timestampMs,
			attachments: attachments.length > 0 ? attachments : undefined,
		};
	}

	/** Send a text message correlated to a specific inbound event. */
	async reply(text: string, inReplyTo: string): Promise<{ eventId: string }> {
		const roomId = this.replyRoomId();
		if (!roomId) {
			throw new Error("Matrix room is not configured yet; send the bot a DM first.");
		}
		return this.adapter.sendMessage(roomId, markdownToMatrixContent(text, { inReplyTo }));
	}

	/** Room a reply belongs to: the room of the message being answered, else the private room. */
	replyRoomId(): string | null {
		return this.lastInboundRoomId ?? this.config.roomId ?? null;
	}

	/** Send a text message to the configured/bound room. */
	async send(text: string): Promise<{ eventId: string }> {
		const roomId = this.replyRoomId();
		if (!roomId) {
			throw new Error("Matrix room is not configured yet; send the bot a DM first.");
		}
		return this.sendTo(roomId, text);
	}

	/** Send a text message to an explicit Matrix room. */
	async sendTo(roomId: string, text: string): Promise<{ eventId: string }> {
		return this.adapter.sendMessage(roomId, markdownToMatrixContent(text));
	}

	async stop(): Promise<void> {
		this.lifecycleController.abort(new Error("Matrix client stopped during attachment download."));
		await this.adapter.stop();
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}
}
