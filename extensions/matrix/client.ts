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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { join } from "node:path";
// Imports from matrix-bot-sdk are kept abstract behind any-typed locals
// because the package is added as a runtime peer dep — we don't want a
// hard import that breaks tools-and-skills' typecheck if the package
// isn't installed yet. The extension only loads when pi resolves it at
// runtime, by which time the dep is present.
//
// biome-ignore lint/suspicious/noExplicitAny: matrix-bot-sdk types resolved at runtime
type AnyClient = any;

import type { MatrixConfig } from "./types.js";
import { setupVerificationHandler } from "./verification.js";

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
	 *
	 * On first run this creates a new Matrix device for the bot. The phone
	 * will see an unverified session — the user runs /matrix verify to
	 * complete the device verification handshake.
	 *
	 * Throws if the access token is rejected, the homeserver is unreachable,
	 * or the crypto store can't be initialised.
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
				// Fast path: skip filter when all entries are valid (common case)
				const hasInvalid = (arr: string[]) => arr.some((u: unknown) => typeof u !== "string");
				return origUpdate(
					msgs, otk, fallback,
					hasInvalid(changed) ? changed.filter((u: unknown) => typeof u === "string") : changed,
					hasInvalid(left) ? left.filter((u: unknown) => typeof u === "string") : left,
				);
			};
		}

		// Accept invites to the configured room and DMs from trusted senders
		// (needed for device verification). Reject everything else.
		this.client.on("room.invite", async (roomId: string, event: AnyClient) => {
			if (roomId === this.config.roomId) {
				await this.client.joinRoom(roomId);
				return;
			}
			// Accept DM invites from trusted senders (for verification flows)
			const sender = event?.sender ?? event?.state_key;
			const trusted = this.config.trustedSenders;
			if (sender && (trusted.length === 0 || trusted.includes(sender))) {
				this.notifyFn?.(`joining DM from ${sender} (room ${roomId})`, "info");
				await this.client.joinRoom(roomId);
				return;
			}
			try { await this.client.leaveRoom(roomId); } catch { /* non-fatal */ }
		});

		// Wire the inbound message handler
		this.client.on("room.message", async (roomId: string, event: AnyClient) => {
			if (roomId !== this.config.roomId) return;
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

		// Set up SAS verification handler — auto-accepts from trusted senders
		if (this.config.encryption) {
			const devId = this.deviceId;
			if (devId) {
				setupVerificationHandler(
					this.client,
					this.config.userId,
					devId,
					this.config.trustedSenders,
					this.notifyFn,
				);
			}
		}

		// Upload cross-signing keys if encryption is enabled and the bot
		// has a password for UIA. The Rust SDK's bootstrapCrossSigning
		// generates keys locally but can't upload them (needs UIA). We
		// generate Ed25519 cross-signing keys ourselves, upload via UIA,
		// and sign the bot's device with the self-signing key.
		if (this.config.encryption && this.config.botPassword) {
			try {
				await this.ensureCrossSigningKeys();
			} catch (err) {
				this.notifyFn?.(`cross-signing setup failed: ${(err as Error).message}`, "warning");
			}
		}
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
		this.connected = false;
	}

	/** Whether the sync loop is connected and running. */
	isConnected(): boolean {
		return this.connected;
	}

	/** Bot's Matrix device ID. */
	private get deviceId(): string | undefined {
		// biome-ignore lint/suspicious/noExplicitAny: CryptoClient.clientDeviceId is a public getter
		return (this.client?.crypto as any)?.clientDeviceId;
	}

	// ── Cross-signing key management ────────────────────────────

	/**
	 * Ensure cross-signing keys are uploaded and the bot's device is
	 * signed. Generates Ed25519 keys ourselves (the Rust SDK binding
	 * can't upload them — it needs UIA which only we can provide).
	 *
	 * Idempotent — checks the server first and skips if already set up.
	 */
	private async ensureCrossSigningKeys(): Promise<void> {
		const userId = this.config.userId;
		const devId = this.deviceId;

		// Check server state (single query — reused for signing below)
		const keysQuery = await this.client.doRequest(
			"POST", "/_matrix/client/v3/keys/query", null,
			{ device_keys: { [userId]: [] } },
		);
		const hasMaster = !!keysQuery?.master_keys?.[userId];
		const hasSelfSigning = !!keysQuery?.self_signing_keys?.[userId];

		// Check if our device is already signed by the self-signing key
		if (hasMaster && hasSelfSigning) {
			const deviceSigs = keysQuery?.device_keys?.[userId]?.[devId ?? ""]?.signatures?.[userId];
			const selfSigningKey = Object.keys(keysQuery.self_signing_keys[userId].keys ?? {})[0];
			if (deviceSigs && selfSigningKey && deviceSigs[selfSigningKey]) {
				this.notifyFn?.("cross-signing: already set up", "info");
				return;
			}
		}

		this.notifyFn?.("cross-signing: uploading keys...", "info");

		const keysDir = join(this.config.cryptoStorePath, "cross-signing");
		mkdirSync(keysDir, { recursive: true });
		const { masterKey, selfSigningKeyPair, userSigningKey } = this.generateCrossSigningKeys(keysDir);

		await this.uploadCrossSigningKeys(masterKey, selfSigningKeyPair.publicPayload, userSigningKey);

		// Sign the bot's device using the already-fetched device key
		const deviceKey = keysQuery?.device_keys?.[userId]?.[devId ?? ""];
		if (deviceKey && devId) {
			await this.signDeviceKey(selfSigningKeyPair, devId, deviceKey);
		}

		this.notifyFn?.("cross-signing: keys uploaded and device signed", "info");
	}

	private generateCrossSigningKeys(keysDir: string): {
		masterKey: CrossSigningKeyPayload;
		selfSigningKeyPair: CrossSigningKeyPairWithPayload;
		userSigningKey: CrossSigningKeyPayload;
	} {
		const userId = this.config.userId;

		// Load or generate each key — all persisted so they survive restarts
		const master = loadOrGenerateKey(join(keysDir, "master.key"));
		const selfSigning = loadOrGenerateKey(join(keysDir, "self-signing.key"));
		const userSig = loadOrGenerateKey(join(keysDir, "user-signing.key"));
		const masterKeyId = `ed25519:${master.pubBase64}`;

		// Build payloads
		const masterPayload: CrossSigningKeyPayload = {
			user_id: userId,
			usage: ["master"],
			keys: { [masterKeyId]: master.pubBase64 },
		};
		masterPayload.signatures = {
			[userId]: { [masterKeyId]: signJsonObject(masterPayload, master.privateKey) },
		};

		const selfSigningKeyId = `ed25519:${selfSigning.pubBase64}`;
		const selfSigningPayload: CrossSigningKeyPayload = {
			user_id: userId,
			usage: ["self_signing"],
			keys: { [selfSigningKeyId]: selfSigning.pubBase64 },
		};
		selfSigningPayload.signatures = {
			[userId]: { [masterKeyId]: signJsonObject(selfSigningPayload, master.privateKey) },
		};

		const userSigningKeyId = `ed25519:${userSig.pubBase64}`;
		const userSigningPayload: CrossSigningKeyPayload = {
			user_id: userId,
			usage: ["user_signing"],
			keys: { [userSigningKeyId]: userSig.pubBase64 },
		};
		userSigningPayload.signatures = {
			[userId]: { [masterKeyId]: signJsonObject(userSigningPayload, master.privateKey) },
		};

		return {
			masterKey: masterPayload,
			selfSigningKeyPair: { ...selfSigning, keyId: selfSigningKeyId, publicPayload: selfSigningPayload },
			userSigningKey: userSigningPayload,
		};
	}

	private async uploadCrossSigningKeys(
		masterKey: CrossSigningKeyPayload,
		selfSigningKey: CrossSigningKeyPayload,
		userSigningKey: CrossSigningKeyPayload,
	): Promise<void> {
		const body = { master_key: masterKey, self_signing_key: selfSigningKey, user_signing_key: userSigningKey };

		// First request — get UIA session
		const uiaChallenge = await this.client.doRequest(
			"POST", "/_matrix/client/v3/keys/device_signing/upload", null, body,
		);

		// If no session returned, upload succeeded without UIA
		if (!uiaChallenge?.session) return;

		// Second request with password auth
		const authedBody = {
			...body,
			auth: {
				type: "m.login.password",
				session: uiaChallenge.session,
				identifier: { type: "m.id.user", user: this.config.userId },
				password: this.config.botPassword,
			},
		};
		await this.client.doRequest(
			"POST", "/_matrix/client/v3/keys/device_signing/upload", null, authedBody,
		);
	}

	private async signDeviceKey(
		selfSigningKeyPair: CrossSigningKeyPairWithPayload,
		devId: string,
		deviceKey: AnyClient,
	): Promise<void> {
		const userId = this.config.userId;

		// Sign the device key with our self-signing key
		const deviceSig = signJsonObject(deviceKey, selfSigningKeyPair.privateKey);

		// Upload the signature
		await this.client.doRequest(
			"POST", "/_matrix/client/v3/keys/signatures/upload", null,
			{
				[userId]: {
					[devId]: {
						user_id: userId,
						device_id: devId,
						algorithms: deviceKey.algorithms,
						keys: deviceKey.keys,
						signatures: {
							...deviceKey.signatures,
							[userId]: {
								...(deviceKey.signatures?.[userId] ?? {}),
								[selfSigningKeyPair.keyId]: deviceSig,
							},
						},
					},
				},
			},
		);
	}
}

// ── Cross-signing helpers ───────────────────────────────────────

interface Ed25519KeyPair {
	pubBase64: string;
	privateKey: Buffer;
}

interface CrossSigningKeyPayload {
	user_id: string;
	usage: string[];
	keys: Record<string, string>;
	signatures?: Record<string, Record<string, string>>;
}

interface CrossSigningKeyPairWithPayload extends Ed25519KeyPair {
	keyId: string;
	publicPayload: CrossSigningKeyPayload;
}

function generateEd25519KeyPair(): Ed25519KeyPair {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const pubDer = publicKey.export({ type: "spki", format: "der" });
	const pubBytes = pubDer.subarray(pubDer.length - 32);
	const privDer = privateKey.export({ type: "pkcs8", format: "der" });
	// Ed25519 PKCS8 DER: 16-byte header + 34 bytes (2-byte wrapper + 32-byte key)
	const privBytes = privDer.subarray(privDer.length - 32);
	return {
		pubBase64: unpadBase64(pubBytes),
		privateKey: privBytes,
	};
}

/** Load a persisted Ed25519 key or generate + save a new one. */
function loadOrGenerateKey(path: string): Ed25519KeyPair {
	try {
		const pem = readFileSync(path, "utf-8");
		const parts = pem.split("\n");
		return { pubBase64: parts[0] ?? "", privateKey: Buffer.from(parts[1] ?? "", "base64") };
	} catch {
		const kp = generateEd25519KeyPair();
		writeFileSync(path, `${kp.pubBase64}\n${kp.privateKey.toString("base64")}`, { mode: 0o600 });
		return kp;
	}
}

function unpadBase64(buf: Buffer): string {
	return buf.toString("base64").replace(/=+$/, "");
}

/** Canonical JSON per Matrix spec — keys sorted, no whitespace. */
function canonicalJson(obj: unknown): string {
	if (obj === null || obj === undefined || typeof obj !== "object") {
		return JSON.stringify(obj);
	}
	if (Array.isArray(obj)) {
		return `[${obj.map(canonicalJson).join(",")}]`;
	}
	const sorted = Object.keys(obj as Record<string, unknown>).sort();
	const entries = sorted.map(
		(k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`,
	);
	return `{${entries.join(",")}}`;
}

/**
 * Sign a JSON object using an Ed25519 private key.
 * Removes `signatures` and `unsigned` before signing per the Matrix spec.
 */
function signJsonObject(obj: CrossSigningKeyPayload | Record<string, unknown>, privateKeyRaw: Buffer): string {
	const copy: Record<string, unknown> = { ...obj };
	delete copy.signatures;
	delete copy.unsigned;
	const canonical = canonicalJson(copy);

	// Import raw Ed25519 private key via PKCS8 DER wrapper
	const pkcs8Header = Buffer.from("302e020100300506032b657004220420", "hex");
	const pkcs8Der = Buffer.concat([pkcs8Header, privateKeyRaw]);
	const keyObj = createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" });

	const sig = cryptoSign(null, Buffer.from(canonical), keyObj);
	return unpadBase64(sig);
}
