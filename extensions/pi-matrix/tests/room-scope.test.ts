/**
 * Room binding tests — one Matrix account, one room per agent.
 *
 * These tests drive MatrixBridgeClient and MatrixTransport through a fake
 * adapter: no live homeserver, token, or room is involved. They cover the
 * failures that matter for per-GM rooms: a reply must never land in another
 * agent's room, foreign inbound must not be buffered, and a room-bound agent
 * must not accumulate unrelated room memberships.
 */

import { describe, expect, it, vi } from "vitest";

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
} from "../adapter.js";
import { MatrixBridgeClient, isConfiguredRoom, shouldJoinMatrixInvite } from "../client.js";
import { MatrixTransport } from "../transport.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const BOT = `@coas-bot:${HOME}`;
const GM_ROOM = "!gm-room:matrix.example.net";
const OTHER_ROOM = "!chief-room:matrix.example.net";

function makeConfig(overrides: Partial<MatrixConfig> = {}): MatrixConfig {
	return {
		homeserver: "https://matrix.example.net",
		userId: BOT,
		accessToken: "fake-token-for-tests",
		storagePath: "/tmp/fake-matrix-sync",
		attachmentCachePath: "/tmp/fake-matrix-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: [],
		channelLabel: "matrix",
		trustedSenders: [JIM],
		allowAnySender: false,
		ingress: {},
		...overrides,
	};
}

interface FakeAdapter extends MatrixClientAdapter {
	callbacks: MatrixAdapterCallbacks;
	sent: Array<{ roomId: string; body: unknown }>;
	joined: string[];
	left: string[];
	emitMessage(event: Partial<MatrixInboundEvent> & { roomId: string; eventId: string }): Promise<void>;
	emitInvite(roomId: string, sender?: string): Promise<void>;
}

function makeAdapter(): FakeAdapter {
	const adapter: FakeAdapter = {
		callbacks: undefined as unknown as MatrixAdapterCallbacks,
		sent: [],
		joined: [],
		left: [],
		crypto: null,
		async start(_config, callbacks) {
			adapter.callbacks = callbacks;
		},
		async stop() {},
		async joinRoom(roomId) {
			adapter.joined.push(roomId);
		},
		async leaveRoom(roomId) {
			adapter.left.push(roomId);
		},
		async sendMessage(roomId, content) {
			adapter.sent.push({ roomId, body: content });
			return { eventId: `$sent-${adapter.sent.length}` };
		},
		isConnected: () => true,
		async emitMessage(event) {
			await adapter.callbacks.onMessage({
				roomId: event.roomId,
				sender: event.sender ?? JIM,
				eventId: event.eventId,
				timestampMs: event.timestampMs ?? Date.now(),
				content: event.content ?? { msgtype: "m.text", body: `hello ${event.eventId}` },
				isHistorical: event.isHistorical ?? false,
				isLocalEcho: event.isLocalEcho ?? false,
			});
		},
		async emitInvite(roomId, sender = JIM) {
			await adapter.callbacks.onMembership({
				roomId,
				sender,
				userId: BOT,
				membership: "invite",
			});
		},
	};
	return adapter;
}

async function startClient(config: MatrixConfig, adapter: FakeAdapter) {
	const client = new MatrixBridgeClient(config, adapter);
	const inbound: Array<{ roomId: string; eventId: string }> = [];
	await client.start((msg) => {
		inbound.push({ roomId: msg.roomId, eventId: msg.eventId });
	});
	return { client, inbound };
}

describe("room binding helpers", () => {
	it("treats an unconfigured room as unrestricted and a configured room as exact", () => {
		expect(isConfiguredRoom(makeConfig(), GM_ROOM)).toBe(true);
		const bound = makeConfig({ roomId: GM_ROOM });
		expect(isConfiguredRoom(bound, GM_ROOM)).toBe(true);
		expect(isConfiguredRoom(bound, OTHER_ROOM)).toBe(false);
	});

	it("only joins the configured room, and only from a trusted sender", () => {
		const bound = makeConfig({ roomId: GM_ROOM });
		expect(shouldJoinMatrixInvite(bound, GM_ROOM, JIM)).toBe(true);
		expect(shouldJoinMatrixInvite(bound, OTHER_ROOM, JIM)).toBe(false);
		expect(shouldJoinMatrixInvite(bound, GM_ROOM, `@mallory:${HOME}`)).toBe(false);
		expect(shouldJoinMatrixInvite(makeConfig(), OTHER_ROOM, JIM)).toBe(true);
	});
});

describe("MatrixBridgeClient room scoping", () => {
	it("drops inbound from unbound rooms and never redirects replies there", async () => {
		const adapter = makeAdapter();
		const config = makeConfig({ roomId: GM_ROOM });
		const { client, inbound } = await startClient(config, adapter);

		await adapter.emitMessage({ roomId: GM_ROOM, eventId: "$mine:1" });
		await adapter.emitMessage({ roomId: OTHER_ROOM, eventId: "$foreign:1" });

		expect(inbound.map((m) => m.eventId)).toEqual(["$mine:1"]);
		expect(client.replyRoomId()).toBe(GM_ROOM);

		await client.send("reply");
		expect(adapter.sent).toHaveLength(1);
		expect(adapter.sent[0]?.roomId).toBe(GM_ROOM);
	});

	it("replies to the configured room even before any inbound arrives", async () => {
		const adapter = makeAdapter();
		const config = makeConfig({ roomId: GM_ROOM });
		const { client } = await startClient(config, adapter);

		await client.send("proactive");
		expect(adapter.sent[0]?.roomId).toBe(GM_ROOM);
	});

	it("falls back to the last accepted inbound room when no room is configured", async () => {
		const adapter = makeAdapter();
		const { client, inbound } = await startClient(makeConfig(), adapter);

		await adapter.emitMessage({ roomId: OTHER_ROOM, eventId: "$one:1" });
		expect(inbound).toHaveLength(1);
		await client.send("dm reply");
		expect(adapter.sent[0]?.roomId).toBe(OTHER_ROOM);

		await adapter.emitMessage({ roomId: GM_ROOM, eventId: "$two:1" });
		await client.send("later reply");
		expect(adapter.sent[1]?.roomId).toBe(GM_ROOM);
	});

	it("does not move the reply room on an untrusted sender", async () => {
		const adapter = makeAdapter();
		const { client, inbound } = await startClient(makeConfig(), adapter);

		await adapter.emitMessage({ roomId: OTHER_ROOM, eventId: "$ok:1" });
		await adapter.emitMessage({
			roomId: GM_ROOM,
			eventId: "$bad:1",
			sender: `@mallory:${HOME}`,
		});
		expect(inbound.map((m) => m.eventId)).toEqual(["$ok:1"]);
		await client.send("reply");
		expect(adapter.sent[0]?.roomId).toBe(OTHER_ROOM);
	});

	it("ignores invites outside the bound room and joins only its own room", async () => {
		const adapter = makeAdapter();
		const config = makeConfig({ roomId: GM_ROOM });
		await startClient(config, adapter);

		await adapter.emitInvite(OTHER_ROOM);
		await adapter.emitInvite(GM_ROOM);

		// Leaving a foreign room would mutate the shared account's membership
		// (withdraw the invite / kick the owning agent), so foreign invites are
		// ignored outright.
		expect(adapter.left).toEqual([]);
		expect(adapter.joined).toContain(GM_ROOM);
		expect(adapter.joined).not.toContain(OTHER_ROOM);
	});

	it("deduplicates replayed events", async () => {
		const adapter = makeAdapter();
		const { inbound } = await startClient(makeConfig({ roomId: GM_ROOM }), adapter);

		await adapter.emitMessage({ roomId: GM_ROOM, eventId: "$dup:1" });
		await adapter.emitMessage({ roomId: GM_ROOM, eventId: "$dup:1" });
		expect(inbound).toHaveLength(1);
	});

	it("keeps replies in the bound room through MatrixTransport.send", async () => {
		const adapter = makeAdapter();
		const config = makeConfig({ roomId: GM_ROOM });
		const { client } = await startClient(config, adapter);
		const transport = new MatrixTransport(client);

		await adapter.emitMessage({ roomId: OTHER_ROOM, eventId: "$foreign:2" });
		const result = await transport.send(
			{ id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" },
			"gm",
			"reply",
		);

		expect(result.accepted).toBe(true);
		expect(adapter.sent[0]?.roomId).toBe(GM_ROOM);
	});

	it("reports a failed send instead of silently dropping it", async () => {
		const adapter = makeAdapter();
		const config = makeConfig();
		const { client } = await startClient(config, adapter);
		const transport = new MatrixTransport(client);

		const result = await transport.send(
			{ id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" },
			"gm",
			"no room yet",
		);

		expect(result.accepted).toBe(false);
		expect(result.error).toContain("not configured");
	});
});

// Keep vi referenced for adapters extended in future cases without lint noise.
void vi;
