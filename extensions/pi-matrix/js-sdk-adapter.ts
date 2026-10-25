/**
 * matrix-js-sdk adapter implementing MatrixClientAdapter.
 *
 * No end-to-end encryption is enabled; current deployment uses unencrypted
 * rooms on a private tailnet. Reconnection is handled by the SDK's internal
 * sync loop.
 */

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
	MatrixMembershipEvent,
	SyncStateStore,
} from "./adapter.js";
import { BoundedTaskSet } from "./resource-bounds.js";
import type { MatrixConfig } from "./types.js";

// biome-ignore lint/suspicious/noExplicitAny: matrix-js-sdk types loaded dynamically
type AnySdk = any;

const SYNC_TIMEOUT_MS = 30_000;
const MAX_CALLBACK_TASKS = 8;

function formatLogArg(arg: unknown): string {
	if (typeof arg === "string") return arg;
	if (arg instanceof Error) return arg.message;
	try {
		return JSON.stringify(arg) ?? String(arg);
	} catch {
		return String(arg);
	}
}

/**
 * SDK log families that are routine noise for a text-only bridge.
 *
 * matrix-js-sdk reports MatrixRTC (Element Call) session housekeeping at warn
 * level for call-membership traffic in a room, so any room where a human uses
 * calls pushes unsolicited `MatrixRTCSession !room…` lines into the session.
 * This bridge never joins calls, so those lines carry no actionable state.
 */
const IGNORED_SDK_LOG_PREFIXES = ["MatrixRTCSession", "MatrixRTC"] as const;

/** True for SDK log messages this bridge deliberately does not surface. */
function isIgnoredSdkLog(message: string): boolean {
	const text = message.trimStart();
	return IGNORED_SDK_LOG_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function routeSdkLog(
	onLog: MatrixAdapterCallbacks["onLog"] | undefined,
	args: unknown[],
	level: "warning" | "error",
): void {
	const message = args.map(formatLogArg).join(" ");
	if (isIgnoredSdkLog(message)) return;
	onLog?.(message, level);
}

/**
 * Silence matrix-js-sdk's module-global `logger`.
 *
 * Module-level SDK code (scheduler, embedded, sliding-sync) logs through the
 * package's global logger — a loglevel logger bound to `console.*` and NOT
 * replaced by the per-client `logger` option. Left as-is, its housekeeping
 * (e.g. "Stopping queue 'message' as it is now empty", pending-event status
 * lines) reaches the console and pi's TUI. Override it so only warn/error reach
 * the extension's notify path.
 */
export async function silenceSdkGlobalLogger(
	onLog?: MatrixAdapterCallbacks["onLog"],
): Promise<void> {
	try {
		const { logger } = await import("matrix-js-sdk/lib/logger.js");
		logger.trace = () => {};
		logger.debug = () => {};
		logger.info = () => {};
		logger.log = () => {};
		logger.warn = (...args: unknown[]) => routeSdkLog(onLog, args, "warning");
		logger.error = (...args: unknown[]) => routeSdkLog(onLog, args, "error");
	} catch {
		/* Deep import shape may change; the per-client logger still applies. */
	}
}

export class MatrixJsSdkAdapter implements MatrixClientAdapter {
	private client?: AnySdk;
	private connected = false;
	private callbacks?: MatrixAdapterCallbacks;
	private syncState: SyncStateStore;
	/** Newest cursor the SDK reported, whether or not it is durable yet. */
	private latestToken: string | null = null;
	/** Cursor already written to the store. */
	private persistedToken: string | null = null;
	/** Serialises cursor writes so two sync events cannot interleave a save. */
	private cursorWrites: Promise<void> = Promise.resolve();
	/**
	 * Optional gate: when it returns false the cursor is held back because the
	 * process still holds unread messages in memory only.
	 */
	private canPersistCursor?: () => boolean;
	private readonly callbackTasks = new BoundedTaskSet(MAX_CALLBACK_TASKS);
	/** Wall clock at start; only used to reject replay when no token was saved. */
	private startWallClockMs = Date.now();
	/**
	 * Whether this client resumed from a persisted sync token. Without one the SDK
	 * does a fresh initial sync and replays recent room history.
	 */
	private resumedFromSavedToken = false;

	crypto = null;

	constructor(syncState: SyncStateStore, options: { canPersistCursor?: () => boolean } = {}) {
		this.syncState = syncState;
		this.canPersistCursor = options.canPersistCursor;
	}

	async start(config: MatrixConfig, callbacks: MatrixAdapterCallbacks): Promise<void> {
		this.callbackTasks.open();
		this.callbacks = callbacks;
		const sdk = await this.loadSdk();
		await silenceSdkGlobalLogger(callbacks.onLog);

		const store = new sdk.MemoryStore();
		this.startWallClockMs = Date.now();
		const savedToken = await this.syncState.load();
		this.resumedFromSavedToken = Boolean(savedToken);
		this.latestToken = savedToken ?? null;
		this.persistedToken = savedToken ?? null;
		if (savedToken) {
			store.setSyncToken(savedToken);
		}

		this.client = sdk.createClient({
			baseUrl: config.homeserver,
			accessToken: config.accessToken,
			userId: config.userId,
			store,
			// Without an explicit logger the SDK falls back to a loglevel logger
			// bound to console.*, which pi's TUI renders as per-request noise
			// ("FetchHttpApi: --> GET ..."). Route warn/error to the extension's
			// notify path and silence the rest.
			logger: this.createSdkLogger(callbacks),
		});

		this.bindLogger(config);
		this.bindSync(sdk, callbacks);
		this.bindMembership(sdk, config, callbacks);
		this.bindTimeline(sdk, config, callbacks);

		if (config.verifyIdentity) {
			await this.verifyCredentialIdentity(config);
		}
		await this.client.startClient({ initialSyncLimit: 1 });
		await this.waitForPrepared(sdk, SYNC_TIMEOUT_MS);
	}

	async stop(): Promise<void> {
		const drainCallbacks = this.callbackTasks.closeAndDrain();
		if (this.client) {
			try {
				await this.client.stopClient();
			} catch {
				/* non-fatal */
			}
		}
		await drainCallbacks;
		this.client = undefined;
		this.connected = false;
		this.callbacks?.onConnectionChange?.(false);
	}

	async joinRoom(roomId: string): Promise<void> {
		if (!this.client) throw new Error("Matrix client is not started");
		await this.client.joinRoom(roomId);
	}

	async leaveRoom(roomId: string): Promise<void> {
		if (!this.client) throw new Error("Matrix client is not started");
		await this.client.leave(roomId);
	}

	async sendMessage(roomId: string, content: Record<string, unknown>): Promise<{ eventId: string }> {
		if (!this.client) throw new Error("Matrix client is not started");
		const response = await this.client.sendEvent(roomId, "m.room.message", content);
		return { eventId: response.event_id ?? "" };
	}

	isConnected(): boolean {
		return this.connected;
	}

	private async loadSdk(): Promise<AnySdk> {
		return import("matrix-js-sdk").catch((err) => {
			throw new Error(
				`matrix-js-sdk is not installed. Run \`npm install matrix-js-sdk\`. ` +
					`Original error: ${(err as Error).message}`,
			);
		});
	}

	private createSdkLogger(callbacks: MatrixAdapterCallbacks): AnySdk {
		const notify = callbacks.onLog;
		const logger: AnySdk = {
			trace: () => {},
			debug: () => {},
			info: () => {},
			// Some matrix-js-sdk internals still use the deprecated `log` alias.
			// Keep it silent as well so legacy paths cannot bypass the filter.
			log: () => {},
			warn: (...args: unknown[]) => {
				routeSdkLog(notify, args, "warning");
			},
			error: (...args: unknown[]) => {
				routeSdkLog(notify, args, "error");
			},
			getChild: () => logger,
		};
		return logger;
	}

	private bindLogger(_config: MatrixConfig): void {
		if (!this.client) return;
		const notify = this.callbacks?.onLog;
		if (!notify) return;
		// matrix-js-sdk logs via a global logger in some versions; best-effort hook.
		try {
			this.client.on("log", (data: { level: string; message: string }) => {
				if (isIgnoredSdkLog(data.message)) return;
				const level = data.level === "error" ? "error" : data.level === "warn" ? "warning" : "info";
				notify(data.message, level);
			});
		} catch {
			/* SDK may not expose log events */
		}
	}

	/** Prove the credential's exact MXID before any sync/join; never echo errors. */
	private async verifyCredentialIdentity(config: MatrixConfig): Promise<void> {
		if (!this.client) throw new Error("Matrix client is not started");
		let whoamiUser: unknown;
		try {
			const whoami = await this.client.whoami();
			whoamiUser = whoami?.user_id;
		} catch (error) {
			const code = error && typeof error === "object" && "errcode" in error ? error.errcode : undefined;
			const safeReason = typeof code === "string" && /^M_[A-Z0-9_]{1,60}$/.test(code)
				? `errcode ${code}` : "error Error";
			throw new Error(`matrix: credential identity could not be verified (${safeReason}); refusing to sync or join`);
		}
		if (whoamiUser !== config.userId) {
			throw new Error("matrix: credential identity mismatch — resolved token does not belong to the rendered matrix.userId; refusing to sync or join");
		}
	}

	private bindSync(sdk: AnySdk, callbacks: MatrixAdapterCallbacks): void {
		if (!this.client) return;
		this.client.on(sdk.ClientEvent.Sync, async (state: string, _prev: string | null, data?: AnySdk) => {
			const connected = state === "PREPARED" || state === "SYNCING" || state === "CATCHUP";
			if (connected !== this.connected) {
				this.connected = connected;
				callbacks.onConnectionChange?.(connected);
			}
			// matrix-js-sdk emits ISyncStateData here ({oldSyncToken, nextSyncToken,
			// catchingUp}); older releases exposed the raw /sync body's next_batch.
			// Reading only one shape silently stops persisting the cursor, so every
			// restart re-syncs from scratch and can replay old messages as new.
			const token = data?.nextSyncToken ?? data?.next_batch;
			if (typeof token !== "string" || token.length === 0) return;
			this.latestToken = token;
			// Do not advance the durable cursor past messages that only exist in this
			// process's unread buffer: a restart would skip mail Jim sent while the
			// agent was busy in a long turn. The transport flushes on drain.
			if (this.canPersistCursor && !this.canPersistCursor()) return;
			await this.persistCursor(token, callbacks);
		});
	}

	/** Persist the newest observed cursor if it is still only in memory. */
	async flushCursor(): Promise<void> {
		const token = this.latestToken;
		if (!token || token === this.persistedToken) return;
		if (this.canPersistCursor && !this.canPersistCursor()) return;
		await this.persistCursor(token, this.callbacks);
	}

	private persistCursor(
		token: string,
		callbacks?: MatrixAdapterCallbacks,
	): Promise<void> {
		if (token === this.persistedToken) return this.cursorWrites;
		this.cursorWrites = this.cursorWrites.then(async () => {
			// Re-check inside the queue: an earlier write may have covered it.
			if (token === this.persistedToken) return;
			try {
				await this.syncState.save(token);
				this.persistedToken = token;
			} catch (err) {
				callbacks?.onLog?.(`failed to persist sync token: ${(err as Error).message}`, "error");
			}
		});
		return this.cursorWrites;
	}

	private bindMembership(sdk: AnySdk, config: MatrixConfig, callbacks: MatrixAdapterCallbacks): void {
		if (!this.client) return;
		this.client.on(sdk.RoomMemberEvent.Membership, (event: AnySdk, member: AnySdk) => {
			if (member.userId !== config.userId) return;
			const roomId = event.getRoomId?.() ?? event.room_id;
			const sender = event.getSender?.();
			const membership = member.membership as string;
			if (!roomId || !membership) return;
			const normalised: MatrixMembershipEvent = {
				roomId,
				sender,
				userId: config.userId,
				membership,
			};
			this.runCallback("membership", callbacks, () => callbacks.onMembership(normalised));
		});
	}

	private bindTimeline(sdk: AnySdk, config: MatrixConfig, callbacks: MatrixAdapterCallbacks): void {
		if (!this.client) return;
		this.client.on(sdk.RoomEvent.Timeline, (event: AnySdk, _room: AnySdk | null, toStartOfTimeline: boolean) => {
			if (toStartOfTimeline) return;
			if (event.getType?.() !== "m.room.message") return;
			const rawEvent = event.event as Record<string, unknown> | undefined;
			if (!rawEvent) return;
			const sender = event.getSender?.();
			if (sender === config.userId) return;
			const status = event.getStatus?.();
			const isLocalEcho = status !== undefined && status !== null && status !== "SENT" && status !== null;
			const timestampMs = event.getTs?.() ?? Date.now();
			const normalised: MatrixInboundEvent = {
				roomId: event.getRoomId?.() ?? `${config.userId}-unknown`,
				sender: sender ?? "unknown",
				eventId: event.getId?.() ?? `${Date.now()}`,
				timestampMs,
				content: (rawEvent.content as Record<string, unknown>) ?? {},
				isHistorical: this.isFreshInitialSyncReplay(timestampMs),
				isLocalEcho,
			};
			this.runCallback("timeline", callbacks, () => callbacks.onMessage(normalised));
		});
	}

	/**
	 * Reject replayed history from a fresh initial sync (no saved token).
	 *
	 * With a saved cursor every returned event is new — including mail sent while
	 * this process was down — so age alone must never discard it.
	 */
	private isFreshInitialSyncReplay(timestampMs: number): boolean {
		return !this.resumedFromSavedToken && timestampMs < this.startWallClockMs;
	}

	private runCallback(
		kind: "membership" | "timeline",
		callbacks: MatrixAdapterCallbacks,
		operation: () => void | Promise<void>,
	): void {
		const accepted = this.callbackTasks.tryRun(
			operation,
			(error) => callbacks.onLog?.(
				`Matrix ${kind} callback failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			),
		);
		if (!accepted) {
			callbacks.onLog?.(`Matrix ${kind} event dropped: callback work limit reached.`, "warning");
		}
	}

	private waitForPrepared(sdk: AnySdk, timeoutMs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client) {
				reject(new Error("Matrix client is not started"));
				return;
			}
			const deadline = setTimeout(() => {
				cleanup();
				reject(new Error(`Matrix sync did not reach prepared state within ${timeoutMs}ms`));
			}, timeoutMs);

			const handler = (state: string) => {
				if (state === "PREPARED" || state === "SYNCING") {
					cleanup();
					resolve();
				}
			};

			const cleanup = () => {
				clearTimeout(deadline);
				this.client?.off(sdk.ClientEvent.Sync, handler);
			};

			this.client?.once(sdk.ClientEvent.Sync, handler);
		});
	}
}
