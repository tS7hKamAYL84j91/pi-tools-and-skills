/**
 * Matrix extension — matrix-bot-sdk client wrapper.
 *
 * Wraps a MatrixClient instance for headless bot use:
 *   - Accepts room invites from trusted senders
 *   - Filters own messages to prevent send/receive loops
 *   - Surfaces m.room.message events to a user-supplied handler
 *
 * Reconnection is handled by matrix-bot-sdk's internal sync loop.
 */

import { mkdirSync } from "node:fs";
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
			if (roomId === this.config.roomId) {
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
			if (event?.sender === this.config.userId) return;
			const trusted = this.config.trustedSenders;
			if (trusted.length > 0 && !trusted.includes(event?.sender)) return;
			const content = event?.content;
			if (
				!content ||
				content.msgtype !== "m.text" ||
				typeof content.body !== "string"
			)
				return;

			const msg: InboundMessage = {
				roomId,
				senderMxid: event.sender,
				body: content.body,
				eventId: event.event_id,
				timestampMs:
					typeof event.origin_server_ts === "number"
						? event.origin_server_ts
						: Date.now(),
			};
			try {
				await this.onInbound?.(msg);
			} catch {
				/* non-fatal */
			}
		});

		// Ensure we've joined the configured room
		try {
			await this.client.joinRoom(this.config.roomId);
		} catch {
			/* non-fatal — invite may arrive later */
		}

		await this.client.start();
		this.connected = true;
	}

	/** Send a text message to the configured room. */
	async send(text: string): Promise<{ eventId: string }> {
		if (!this.client) throw new Error("Matrix client is not started");
		const eventId = await this.client.sendText(this.config.roomId, text);
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
