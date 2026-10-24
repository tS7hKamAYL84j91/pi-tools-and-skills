/**
 * Matrix sync cursor persistence + fresh-initial-sync replay guard.
 *
 * Live bug being pinned here: matrix-js-sdk (v41) emits `ISyncStateData`
 * ({oldSyncToken, nextSyncToken, catchingUp}) on ClientEvent.Sync, not the raw
 * /sync body's `next_batch`. A binder that only reads `next_batch` never saves a
 * cursor, so every restart re-syncs from the beginning and re-delivers recent
 * history as if it were new mail.
 */

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	sdk: {
		MemoryStore: class {
			setSyncToken(_token: string) {}
		},
		createClient: vi.fn(),
		ClientEvent: { Sync: "sync" },
		RoomMemberEvent: { Membership: "membership" },
		RoomEvent: { Timeline: "timeline" },
	},
}));

vi.mock("matrix-js-sdk", () => mocks.sdk);

import { MatrixJsSdkAdapter } from "../js-sdk-adapter.js";
import type { MatrixAdapterCallbacks, MatrixInboundEvent } from "../adapter.js";
import type { MatrixConfig } from "../types.js";

type Handler = (...args: unknown[]) => unknown;

interface FakeClient {
	on: (event: string, handler: Handler) => void;
	off: (event: string, handler: Handler) => void;
	once: (event: string, handler: Handler) => void;
	startClient: () => Promise<void>;
	stopClient: () => Promise<void>;
	emit: (event: string, ...args: unknown[]) => void;
}

function createFakeClient(): FakeClient {
	const listeners = new Map<string, Handler[]>();
	const add = (event: string, handler: Handler) => {
		listeners.set(event, [...(listeners.get(event) ?? []), handler]);
	};
	const remove = (event: string, handler: Handler) => {
		listeners.set(event, (listeners.get(event) ?? []).filter((h) => h !== handler));
	};
	return {
		on: add,
		off: remove,
		// waitForPrepared registers a once-handler right after startClient.
		once: (event, handler) => {
			if (event === "sync") handler("PREPARED");
		},
		startClient: async () => {},
		stopClient: async () => {},
		emit: (event, ...args) => {
			for (const handler of listeners.get(event) ?? []) handler(...args);
		},
	};
}

function config(): MatrixConfig {
	// No roomId: unbound bootstrap, so start() does not attempt joins.
	return {
		homeserver: "https://matrix.example.org",
		accessToken: "fake-token-not-a-live-secret",
		userId: "@bot:example.org",
		trustedSenders: ["@jim:example.org"],
	} as unknown as MatrixConfig;
}

function timelineEvent(options: { id: string; ts: number; sender?: string }) {
	return {
		getType: () => "m.room.message",
		getSender: () => options.sender ?? "@jim:example.org",
		getStatus: () => undefined,
		getRoomId: () => "!room:example.org",
		getId: () => options.id,
		getTs: () => options.ts,
		event: { content: { msgtype: "m.text", body: "hello" } },
	};
}

async function startHarness(savedToken: string | null, save?: (token: string) => Promise<void>) {
	const client = createFakeClient();
	mocks.sdk.createClient.mockReturnValue(client);
	const saveCalls: string[] = [];
	const saveFn = vi.fn(async (token: string) => {
		saveCalls.push(token);
		await save?.(token);
	});
	const load = vi.fn(async () => savedToken);
	const adapter = new MatrixJsSdkAdapter({
		load,
		save: saveFn,
		reset: vi.fn(async () => {}),
	});
	const inbound: MatrixInboundEvent[] = [];
	const onLog = vi.fn();
	const callbacks = {
		onMembership: () => {},
		onMessage: (event: MatrixInboundEvent) => {
			inbound.push(event);
		},
		onLog,
	} as unknown as MatrixAdapterCallbacks;
	await adapter.start(config(), callbacks);
	return { adapter, client, saveFn, saveCalls, load, inbound, onLog };
}

describe("MatrixJsSdkAdapter sync cursor persistence", () => {
	it("persists the cursor from the current SDK ISyncStateData shape", async () => {
		const { client, saveFn, saveCalls } = await startHarness(null);
		client.emit("sync", "PREPARED", "CONNECTING", {
			oldSyncToken: undefined,
			nextSyncToken: "s_1_2_3",
			catchingUp: false,
		});
		await vi.waitFor(() => expect(saveFn).toHaveBeenCalled());
		expect(saveCalls).toEqual(["s_1_2_3"]);
	});

	it("still accepts the legacy raw next_batch body", async () => {
		const { client, saveCalls } = await startHarness(null);
		client.emit("sync", "SYNCING", "PREPARED", { next_batch: "legacy_token" });
		await vi.waitFor(() => expect(saveCalls).toEqual(["legacy_token"]));
	});

	it("saves once per distinct cursor and skips repeats", async () => {
		const { client, saveCalls } = await startHarness(null);
		client.emit("sync", "SYNCING", "PREPARED", { nextSyncToken: "s_1" });
		client.emit("sync", "SYNCING", "SYNCING", { nextSyncToken: "s_1" });
		client.emit("sync", "SYNCING", "SYNCING", { nextSyncToken: "s_2" });
		await vi.waitFor(() => expect(saveCalls).toEqual(["s_1", "s_2"]));
	});

	it("surfaces a persistence failure instead of silently dropping the cursor", async () => {
		const { client, onLog } = await startHarness(null, async () => {
			throw new Error("disk full");
		});
		client.emit("sync", "SYNCING", "PREPARED", { nextSyncToken: "s_1" });
		await vi.waitFor(() =>
			expect(onLog).toHaveBeenCalledWith("failed to persist sync token: disk full", "error"),
		);
	});

	it("does not treat a sync error state as connected or token-bearing", async () => {
		const { client, saveCalls, onLog } = await startHarness(null);
		client.emit("sync", "ERROR", "SYNCING", { error: new Error("boom") });
		await Promise.resolve();
		expect(saveCalls).toEqual([]);
		expect(onLog).not.toHaveBeenCalled();
	});
});

describe("MatrixJsSdkAdapter fresh-initial-sync replay guard", () => {
	it("marks pre-start history from a tokenless fresh sync as historical", async () => {
		const { client, inbound } = await startHarness(null);
		const startedAtMs = Date.now();
		client.emit("timeline", timelineEvent({ id: "$old", ts: startedAtMs - 60_000 }), null, false);
		client.emit("timeline", timelineEvent({ id: "$new", ts: startedAtMs + 5_000 }), null, false);
		await vi.waitFor(() => expect(inbound).toHaveLength(2));
		expect(inbound[0]).toMatchObject({ eventId: "$old", isHistorical: true });
		expect(inbound[1]).toMatchObject({ eventId: "$new", isHistorical: false });
	});

	it("delivers mail that arrived while the process was down when a cursor was saved", async () => {
		const { client, inbound, load } = await startHarness("s_saved");
		expect(load).toHaveBeenCalled();
		const startedAtMs = Date.now();
		client.emit("timeline", timelineEvent({ id: "$downtime", ts: startedAtMs - 90_000 }), null, false);
		await vi.waitFor(() => expect(inbound).toHaveLength(1));
		// A resumed cursor means the SDK already skipped history: this is new mail.
		expect(inbound[0]).toMatchObject({ eventId: "$downtime", isHistorical: false });
	});
});
