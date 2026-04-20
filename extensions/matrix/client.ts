/**
 * Matrix extension — matrix-bot-sdk client wrapper.
 *
 * Wraps a MatrixClient instance for headless bot use:
 *   - Optional E2EE via Rust crypto (encryption defaults to off)
 *   - Accepts room invites from trusted senders
 *   - Filters own messages to prevent send/receive loops
 *   - Surfaces m.room.message events to a user-supplied handler
 *
 * Reconnection is handled by matrix-bot-sdk's internal sync loop.
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

import type { MatrixConfig } from "./types.js";

// ── Public types ────────────────────────────────────────────────

/** Decrypted inbound message handed to the bridge. */
export interface InboundMessage {
	/** Room ID this message arrived in (always === config.roomId for our wrapper) */
	roomId: string;
	/** Sender MXID — e.g. "@jim:matrix.org" */
	senderMxid: string;
	/** Plain-text message body */
	body: string;
	/** Matrix event ID, useful for replies / reactions */
	eventId: string;
	/** Server timestamp in ms since epoch */
	timestampMs: number;
}

/** Callback shape for incoming messages. */
type InboundHandler = (msg: InboundMessage) => void | Promise<void>;

/** Callback for surfacing log messages to the extension UI. */
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
			SimpleFsStorageProvider: AnyClient;
			RustSdkCryptoStorageProvider: AnyClient;
			LogService: AnyClient;
			LogLevel: AnyClient;
		};
		const { MatrixClient, SimpleFsStorageProvider, RustSdkCryptoStorageProvider, LogService, LogLevel } = sdk;

		// Route matrix-bot-sdk logs through the extension UI instead of
		// stderr. Without this, console.error() from the default
		// ConsoleLogger leaks into the TUI input box.
		const notifyRef = this.notifyFn;
		const formatArgs = (args: unknown[]): string =>
			args.map((a) => {
				if (a instanceof Error) return a.message;
				if (typeof a === "object" && a !== null) {
					try { return JSON.stringify(a); } catch { return String(a); }
				}
				return String(a);
			}).join(" ");
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

		// Patch updateSyncData to filter out undefined entries in device
		// lists. Continuwuity sometimes sends null/undefined in
		// device_lists.changed which crashes the Rust SDK's UserId
		// constructor ("Expect value to be String, but received Undefined").
		// Without this patch the entire sync handler fails and
		// to_device.decrypted events are never emitted.
		if (this.client.crypto) {
			const origUpdate = this.client.crypto.updateSyncData.bind(this.client.crypto);
			this.client.crypto.updateSyncData = async (
				msgs: AnyClient, otk: AnyClient, fallback: AnyClient,
				changed: string[], left: string[],
			) => {
				const hasInvalid = (arr: string[]) => arr.some((u: unknown) => typeof u !== "string");
				return origUpdate(
					msgs, otk, fallback,
					hasInvalid(changed) ? changed.filter((u: unknown) => typeof u === "string") : changed,
					hasInvalid(left) ? left.filter((u: unknown) => typeof u === "string") : left,
				);
			};
		}

		// Accept invites to the configured room and DMs from trusted senders.
		this.client.on("room.invite", async (roomId: string, event: AnyClient) => {
			if (roomId === this.config.roomId) {
				await this.client.joinRoom(roomId);
				return;
			}
			// Accept DM invites from trusted senders
			const sender = event?.sender ?? event?.state_key;
			const trusted = this.config.trustedSenders;
			if (sender && (trusted.length === 0 || trusted.includes(sender))) {
				this.notifyFn?.(`joining DM from ${sender} (room ${roomId})`, "info");
				await this.client.joinRoom(roomId);
				return;
			}
			try { await this.client.leaveRoom(roomId); } catch { /* non-fatal */ }
		});

		// Wire the inbound message handler — listen to ALL rooms on this
		// private homeserver (no room filter). Trusted sender check still applies.
		this.client.on("room.message", async (roomId: string, event: AnyClient) => {
			if (event?.sender === this.config.userId) return; // own echo
			// Reject messages from untrusted senders (empty list = accept all)
			const trusted = this.config.trustedSenders;
			if (trusted.length > 0 && !trusted.includes(event?.sender)) return;
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

		// Surface decryption failures through the extension UI instead of stderr
		this.client.on("room.failed_decryption", (_roomId: string, _event: AnyClient, err: AnyClient) => {
			this.notifyFn?.(`decrypt failed: ${(err as Error).message}`, "warning");
		});

		// Ensure we've joined the configured room. The room.invite handler above
		// only catches LIVE invites; if the bot was invited before the extension
		// started, the invite event is in the past and the handler never fires.
		// joinRoom is idempotent — calling it when already joined is a no-op.
		try {
			await this.client.joinRoom(this.config.roomId);
		} catch {
			// Non-fatal — the room might not exist yet, or the invite is pending.
			// The room.invite handler will catch it when the invite arrives live.
		}

		// Start the sync loop. matrix-bot-sdk handles reconnection internally.
		await this.client.start();
		this.connected = true;

	}

	/** Send a text message to the configured room. */
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
		this.connected = false;
	}

	/** Whether the sync loop is connected and running. */
	isConnected(): boolean {
		return this.connected;
	}

}

