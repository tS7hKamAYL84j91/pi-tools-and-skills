/**
 * Matrix extension — matrix-bot-sdk wrapper with end-to-end encryption.
 *
 * Wraps a single MatrixClient instance configured for headless bot use:
 *   - Rust-backed E2EE via @turt2live/matrix-bot-sdk-crypto-nodejs
 *   - File-backed crypto store at config.cryptoStorePath
 *   - Auto-accepts the configured room invite (and only that room)
 *   - Filters own messages to prevent send/receive loops
 *   - Surfaces decrypted m.room.message events to a user-supplied handler
 *
 * Reconnection is handled by matrix-bot-sdk's internal sync loop; we add
 * a small wrapper to track connection state for the UI widget.
 *
 * Why matrix-bot-sdk and not matrix-js-sdk: matrix-js-sdk's persistence
 * layer assumes IndexedDB and requires fake-indexeddb + node-localstorage
 * shims to work in Node. matrix-bot-sdk + crypto-nodejs is purpose-built
 * for headless bots with native file-backed crypto storage.
 */

import { mkdirSync } from "node:fs";
// Imports from matrix-bot-sdk are kept abstract behind any-typed locals
// because the package is added as a runtime peer dep — we don't want a
// hard import that breaks tools-and-skills' typecheck if the package
// isn't installed yet. The extension only loads when pi resolves it at
// runtime, by which time the dep is present.
//
// biome-ignore lint/suspicious/noExplicitAny: matrix-bot-sdk types resolved at runtime
type AnyClient = any;

import type { MatrixConfig, MatrixStatus } from "./types.js";

// ── Public types ────────────────────────────────────────────────

/** Decrypted inbound message handed to the bridge. */
export interface InboundMessage {
	/** Room ID this message arrived in (always === config.roomId for our wrapper) */
	roomId: string;
	/** Sender MXID — e.g. "@jim:matrix.org" */
	senderMxid: string;
	/** Plain-text message body (post-decrypt for E2EE rooms) */
	body: string;
	/** Matrix event ID, useful for replies / reactions */
	eventId: string;
	/** Server timestamp in ms since epoch */
	timestampMs: number;
}

/** Callback shape for incoming messages. */
type InboundHandler = (msg: InboundMessage) => void | Promise<void>;

// ── Client wrapper ──────────────────────────────────────────────

export class MatrixBridgeClient {
	private client: AnyClient = null;
	private status: MatrixStatus = {
		connected: false,
		pendingVerifications: 0,
	};
	private onInbound?: InboundHandler;

	constructor(private config: MatrixConfig) {}

	/**
	 * Initialise the matrix-bot-sdk client and start the sync loop.
	 *
	 * On first run this creates a new Matrix device for the bot. The phone
	 * will see an unverified session — the user runs /matrix verify to
	 * complete the device verification handshake.
	 *
	 * Throws if the access token is rejected, the homeserver is unreachable,
	 * or the crypto store can't be initialised.
	 */
	async start(onInbound: InboundHandler): Promise<void> {
		this.onInbound = onInbound;

		// Lazy import so the dep is only loaded when the extension actually runs.
		// matrix-bot-sdk re-exports the Rust crypto storage provider; the
		// @matrix-org/matrix-sdk-crypto-nodejs binding it uses internally is
		// pulled in as a transitive dep.
		const sdk = await import("matrix-bot-sdk").catch((err) => {
			throw new Error(
				`matrix-bot-sdk is not installed. Run \`npm install matrix-bot-sdk\` ` +
				`in tools-and-skills/. Original error: ${(err as Error).message}`,
			);
		}) as {
			MatrixClient: AnyClient;
			AutojoinRoomsMixin: AnyClient;
			SimpleFsStorageProvider: AnyClient;
			RustSdkCryptoStorageProvider: AnyClient;
		};
		const { MatrixClient, AutojoinRoomsMixin, SimpleFsStorageProvider, RustSdkCryptoStorageProvider } = sdk;

		// Storage providers — sync state and crypto state both go to disk
		mkdirSync(this.config.cryptoStorePath, { recursive: true });
		const storage = new SimpleFsStorageProvider(`${this.config.cryptoStorePath}/sync.json`);

		let crypto: AnyClient = null;
		if (this.config.encryption) {
			if (!RustSdkCryptoStorageProvider) {
				throw new Error(
					`Encryption is enabled but RustSdkCryptoStorageProvider is not exported by your matrix-bot-sdk version. ` +
					`Upgrade to a version that bundles crypto support, or set "encryption": false (NOT recommended).`,
				);
			}
			crypto = new RustSdkCryptoStorageProvider(`${this.config.cryptoStorePath}/crypto`);
		}

		// Build the client
		this.client = new MatrixClient(
			this.config.homeserver,
			this.config.accessToken,
			storage,
			crypto,
		);

		// Restrict auto-join to ONLY the configured room — never auto-join other invites
		AutojoinRoomsMixin.setupOnClient({
			...this.client,
			joinRoom: async (roomId: string) => {
				if (roomId !== this.config.roomId) {
					// Reject invites to any other room
					try { await this.client.leaveRoom(roomId); } catch { /* non-fatal */ }
					return;
				}
				return this.client.joinRoom(roomId);
			},
		});

		// Wire the inbound message handler
		this.client.on("room.message", async (roomId: string, event: AnyClient) => {
			if (roomId !== this.config.roomId) return;
			if (event?.sender === this.config.userId) return; // own echo
			const content = event?.content;
			if (!content || content.msgtype !== "m.text" || typeof content.body !== "string") return;

			const msg: InboundMessage = {
				roomId,
				senderMxid: event.sender,
				body: content.body,
				eventId: event.event_id,
				timestampMs: typeof event.origin_server_ts === "number" ? event.origin_server_ts : Date.now(),
			};
			try {
				await this.onInbound?.(msg);
			} catch {
				/* handler errors are non-fatal — log via the extension's UI in index.ts */
			}
		});

		// Start the sync loop. matrix-bot-sdk handles reconnection internally.
		await this.client.start();
		this.status.connected = true;
		this.status.lastSyncMs = Date.now();
		this.status.deviceId = this.client.crypto?.clientDeviceId;
		this.status.roomEncrypted = this.config.encryption;
	}

	/** Send an encrypted text message to the configured room. */
	async send(text: string): Promise<{ eventId: string }> {
		if (!this.client) throw new Error("Matrix client is not started");
		const eventId = await this.client.sendText(this.config.roomId, text);
		return { eventId };
	}

	/** Stop the sync loop and release resources. Called from session_shutdown. */
	async stop(): Promise<void> {
		if (!this.client) return;
		try { await this.client.stop(); } catch { /* non-fatal */ }
		this.client = null;
		this.status.connected = false;
	}

	/** Snapshot of the connection state for the UI widget and matrix_status tool. */
	getStatus(): MatrixStatus {
		return { ...this.status };
	}
}
