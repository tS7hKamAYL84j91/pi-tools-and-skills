/**
 * Matrix extension — matrix-bot-sdk client wrapper.
 *
 * Wraps a MatrixClient instance for headless bot use:
 *   - Accepts room invites from trusted senders
 *   - Filters own messages to prevent send/receive loops
 *   - Surfaces text and media m.room.message events to a user-supplied handler
 *
 * Reconnection is handled by matrix-bot-sdk's internal sync loop.
 */

import { mkdirSync } from "node:fs";
import type { InboundAttachment } from "../../lib/message-transport.js";
import { extractMatrixAttachment, isMatrixMediaMsgtype } from "./attachments.js";
import type { MatrixDownloadClient, MatrixRoomMessageEvent } from "./attachments.js";
import { markdownToMatrixContent } from "./markdown.js";
// biome-ignore lint/suspicious/noExplicitAny: matrix-bot-sdk types resolved at runtime
type AnyClient = any;

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

// ── Client wrapper ──────────────────────────────────────────────

export class MatrixBridgeClient {
	private client: AnyClient = null;
	private connected = false;
	private onInbound?: InboundHandler;
	private notifyFn?: NotifyFn;

	constructor(private config: MatrixConfig) {}

	/**
	 * Initialise the matrix-bot-sdk client and start the sync loop.
	 * Throws if the access token is rejected or the homeserver is unreachable.
	 */
	async start(onInbound: InboundHandler, notify?: NotifyFn): Promise<void> {
		this.onInbound = onInbound;
		this.notifyFn = notify;

		const sdk = (await import("matrix-bot-sdk").catch((err) => {
			throw new Error(
				`matrix-bot-sdk is not installed. Run \`npm install matrix-bot-sdk\`. ` +
					`Original error: ${(err as Error).message}`,
			);
		})) as {
			MatrixClient: AnyClient;
			SimpleFsStorageProvider: AnyClient;
			LogService: AnyClient;
			LogLevel: AnyClient;
		};
		const { MatrixClient, SimpleFsStorageProvider, LogService, LogLevel } = sdk;

		// Route matrix-bot-sdk logs through the extension UI
		const notifyRef = this.notifyFn;
		const formatArgs = (args: unknown[]): string =>
			args
				.map((a) => {
					if (a instanceof Error) return a.message;
					if (typeof a === "object" && a !== null) {
						try {
							return JSON.stringify(a);
						} catch {
							return String(a);
						}
					}
					return String(a);
				})
				.join(" ");
		LogService.setLogger({
			info: () => {},
			debug: () => {},
			trace: () => {},
			warn(module: string, ...args: unknown[]) {
				notifyRef?.(`[${module}] ${formatArgs(args)}`, "warning");
			},
			error(module: string, ...args: unknown[]) {
				notifyRef?.(`[${module}] ${formatArgs(args)}`, "error");
			},
		});
		LogService.setLevel(LogLevel.WARN);

		// Sync state storage
		mkdirSync(this.config.storagePath, { recursive: true });
		const storage = new SimpleFsStorageProvider(
			`${this.config.storagePath}/sync.json`,
		);

		// Build the client (no crypto — unencrypted rooms on private tailnet)
		this.client = new MatrixClient(
			this.config.homeserver,
			this.config.accessToken,
			storage,
		);

		// Accept invites to the configured room and DMs from trusted senders.
		this.client.on("room.invite", async (roomId: string, event: AnyClient) => {
			if (this.config.roomId && roomId === this.config.roomId) {
				await this.client.joinRoom(roomId);
				return;
			}
			const sender = event?.sender ?? event?.state_key;
			const trusted = this.config.trustedSenders;
			if (sender && (trusted.length === 0 || trusted.includes(sender))) {
				this.notifyFn?.(`joining DM from ${sender} (room ${roomId})`, "info");
				await this.client.joinRoom(roomId);
				return;
			}
			try {
				await this.client.leaveRoom(roomId);
			} catch {
				/* non-fatal */
			}
		});

		// Listen to ALL rooms on this private homeserver. Trusted sender filter applies.
		this.client.on("room.message", async (roomId: string, event: AnyClient) => {
			const msg = await this.buildInboundMessage(roomId, event as MatrixRoomMessageEvent);
			if (!msg) return;
			try {
				await this.onInbound?.(msg);
			} catch {
				/* non-fatal */
			}
		});

		// Ensure we've joined the configured room when one is configured.
		if (this.config.roomId) {
			try {
				await this.client.joinRoom(this.config.roomId);
			} catch {
				/* non-fatal — invite may arrive later */
			}
		}

		await this.client.start();
		this.connected = true;
	}

	async buildInboundMessage(roomId: string, event: MatrixRoomMessageEvent): Promise<InboundMessage | null> {
		if (event.sender === this.config.userId) return null;
		const trusted = this.config.trustedSenders;
		if (!event.sender || (trusted.length > 0 && !trusted.includes(event.sender))) return null;

		const content = event.content;
		const msgtype = content?.msgtype;
		if (!content || !msgtype) return null;

		const isTextLike = msgtype === "m.text" || msgtype === "m.notice" || msgtype === "m.emote";
		const attachments = isMatrixMediaMsgtype(msgtype)
			? [await extractMatrixAttachment(this.config, this.client as MatrixDownloadClient, roomId, event)]
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
			roomId,
			senderMxid: event.sender,
			body,
			eventId: event.event_id ?? `${roomId}-${Date.now()}`,
			timestampMs: event.origin_server_ts ?? Date.now(),
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
		if (!this.client) throw new Error("Matrix client is not started");
		const eventId = await this.client.sendMessage(roomId, markdownToMatrixContent(text));
		return { eventId };
	}

	async stop(): Promise<void> {
		if (!this.client) return;
		try {
			await this.client.stop();
		} catch {
			/* non-fatal */
		}
		this.client = null;
		this.connected = false;
	}

	isConnected(): boolean {
		return this.connected;
	}
}
