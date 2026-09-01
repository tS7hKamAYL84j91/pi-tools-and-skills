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

export class MatrixJsSdkAdapter implements MatrixClientAdapter {
	private client?: AnySdk;
	private connected = false;
	private callbacks?: MatrixAdapterCallbacks;
	private syncState: SyncStateStore;
	private pendingToken: string | null = null;
	private readonly callbackTasks = new BoundedTaskSet(MAX_CALLBACK_TASKS);

	crypto = null;

	constructor(syncState: SyncStateStore) {
		this.syncState = syncState;
	}

	async start(config: MatrixConfig, callbacks: MatrixAdapterCallbacks): Promise<void> {
		this.callbackTasks.open();
		this.callbacks = callbacks;
		const sdk = await this.loadSdk();

		const store = new sdk.MemoryStore();
		const savedToken = await this.syncState.load();
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
				notify?.(args.map(formatLogArg).join(" "), "warning");
			},
			error: (...args: unknown[]) => {
				notify?.(args.map(formatLogArg).join(" "), "error");
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
				const level = data.level === "error" ? "error" : data.level === "warn" ? "warning" : "info";
				notify(data.message, level);
			});
		} catch {
			/* SDK may not expose log events */
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
			const token = data?.next_batch;
			if (typeof token === "string" && token.length > 0 && token !== this.pendingToken) {
				this.pendingToken = token;
				try {
					await this.syncState.save(token);
				} catch (err) {
					callbacks.onLog?.(`failed to persist sync token: ${(err as Error).message}`, "error");
				}
			}
		});
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
			const normalised: MatrixInboundEvent = {
				roomId: event.getRoomId?.() ?? `${config.userId}-unknown`,
				sender: sender ?? "unknown",
				eventId: event.getId?.() ?? `${Date.now()}`,
				timestampMs: event.getTs?.() ?? Date.now(),
				content: (rawEvent.content as Record<string, unknown>) ?? {},
				isHistorical: false,
				isLocalEcho,
			};
			this.runCallback("timeline", callbacks, () => callbacks.onMessage(normalised));
		});
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
