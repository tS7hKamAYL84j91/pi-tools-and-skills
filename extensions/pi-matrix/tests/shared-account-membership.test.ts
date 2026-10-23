/**
 * Shared-account membership tests.
 *
 * Several room-bound agents run on ONE Matrix account, and join/leave are
 * account-global. These tests use one shared account state behind two clients
 * (not independent mocks), so a cross-client mutation is actually observable:
 * a foreign-invite handler that leaves the room would withdraw the invite or
 * kick the owning agent out.
 *
 * Fake adapter + fake account only: no homeserver, token, or live room.
 */

import { describe, expect, it } from "vitest";

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
	MatrixMembershipEvent,
} from "../adapter.js";
import { MatrixBridgeClient } from "../client.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const BOT = `@coas-bot:${HOME}`;
const ROOM_A = "!gm-a:matrix.example.net";
const ROOM_B = "!gm-b:matrix.example.net";

type Membership = "invited" | "joined" | "left";

/** One Matrix account behind every client: membership is global state. */
function makeAccount() {
	return {
		memberships: new Map<string, Membership>(),
		log: [] as string[],
	};
}

type Account = ReturnType<typeof makeAccount>;

function makeConfig(roomId: string): MatrixConfig {
	return {
		homeserver: `https://${HOME}`,
		userId: BOT,
		roomId,
		accessToken: "dummy-fixture-token",
		storagePath: `/tmp/fake-sync-${roomId.replace(/[^A-Za-z0-9]+/g, "_")}`,
		attachmentCachePath: "/tmp/fake-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: [],
		channelLabel: "matrix",
		trustedSenders: [JIM],
		allowAnySender: false,
		ingress: {},
	};
}

function makeAdapter(account: Account, label: string) {
	const adapter = {
		callbacks: undefined as unknown as MatrixAdapterCallbacks,
		crypto: null,
		async start(_config: MatrixConfig, callbacks: MatrixAdapterCallbacks) {
			adapter.callbacks = callbacks;
		},
		async stop() {},
		async joinRoom(roomId: string) {
			account.memberships.set(roomId, "joined");
			account.log.push(`${label}:join:${roomId}`);
		},
		async leaveRoom(roomId: string) {
			// Account-global side effect — exactly what a foreign-invite handler
			// must not cause.
			account.memberships.set(roomId, "left");
			account.log.push(`${label}:leave:${roomId}`);
		},
		async sendMessage() {
			return { eventId: "$sent" };
		},
		isConnected: () => true,
		/** Realistic invite: no invite event once the account has joined. */
		async invite(roomId: string, sender = JIM) {
			if (account.memberships.get(roomId) === "joined") return;
			account.memberships.set(roomId, "invited");
			await adapter.emitInvite(roomId, sender);
		},
		/** Dispatch a membership event without mutating account state (stale/duplicate). */
		async emitInvite(roomId: string, sender = JIM) {
			const event: MatrixMembershipEvent = { roomId, sender, userId: BOT, membership: "invite" };
			await adapter.callbacks.onMembership(event);
		},
		async emitMessage(event: Partial<MatrixInboundEvent> & { roomId: string; eventId: string }) {
			await adapter.callbacks.onMessage({
				roomId: event.roomId,
				sender: event.sender ?? JIM,
				eventId: event.eventId,
				timestampMs: event.timestampMs ?? Date.now(),
				content: event.content ?? { msgtype: "m.text", body: "hello" },
				isHistorical: event.isHistorical ?? false,
				isLocalEcho: event.isLocalEcho ?? false,
			});
		},
	};
	return adapter;
}

async function startAgent(account: Account, roomId: string, label: string) {
	const adapter = makeAdapter(account, label);
	const client = new MatrixBridgeClient(makeConfig(roomId), adapter as unknown as MatrixClientAdapter);
	const inbound: Array<{ roomId: string; eventId: string }> = [];
	await client.start((msg) => {
		inbound.push({ roomId: msg.roomId, eventId: msg.eventId });
	});
	return { adapter, client, inbound };
}

describe("one Matrix account, several room-bound agents", () => {
	it("a foreign invite is ignored by name, never left or joined", async () => {
		const account = makeAccount();
		const a = await startAgent(account, ROOM_A, "A");
		const b = await startAgent(account, ROOM_B, "B");

		// Jim invites the account to A's room; both clients receive that event.
		account.memberships.set(ROOM_A, "invited");
		await a.adapter.emitInvite(ROOM_A);
		await b.adapter.emitInvite(ROOM_A);

		// A joins its own room; B must not touch account membership at all.
		expect(account.memberships.get(ROOM_A)).toBe("joined");
		// B's only membership action is joining its OWN room at startup.
		expect(account.log.filter((entry) => entry.startsWith("B:") && entry.includes(ROOM_A))).toEqual([]);
		expect(account.log.filter((entry) => entry.startsWith("B:leave"))).toEqual([]);
		expect(account.log).toContain(`A:join:${ROOM_A}`);
	});

	it("does not let one client's foreign-invite handling kick the owner back out", async () => {
		const account = makeAccount();
		const a = await startAgent(account, ROOM_A, "A");
		const b = await startAgent(account, ROOM_B, "B");

		// Order that used to break: B sees the invite first, then A joins.
		account.memberships.set(ROOM_A, "invited");
		await b.adapter.emitInvite(ROOM_A);
		expect(account.memberships.get(ROOM_A)).toBe("invited"); // unchanged by B
		await a.adapter.emitInvite(ROOM_A);
		expect(account.memberships.get(ROOM_A)).toBe("joined");

		// A late duplicate invite from another client still changes nothing.
		await b.adapter.emitInvite(ROOM_A);
		expect(account.memberships.get(ROOM_A)).toBe("joined");
		expect(account.log).not.toContain(`B:leave:${ROOM_A}`);
	});

	it("ignores an untrusted invite to its own room instead of leaving it", async () => {
		const account = makeAccount();
		const config = makeConfig(ROOM_A);
		const adapter = makeAdapter(account, "A");
		const client = new MatrixBridgeClient(config, adapter as unknown as MatrixClientAdapter);
		await client.start(() => {});

		account.memberships.set(ROOM_A, "invited");
		await adapter.emitInvite(ROOM_A, `@mallory:${HOME}`);
		expect(account.log).not.toContain(`A:leave:${ROOM_A}`);
		expect(account.memberships.get(ROOM_A)).toBe("invited");
	});

	it("keeps the unbound bootstrap behaviour for a single-client account", async () => {
		const account = makeAccount();
		const adapter = makeAdapter(account, "L");
		const config = { ...makeConfig(ROOM_A), roomId: undefined };
		const client = new MatrixBridgeClient(config, adapter as unknown as MatrixClientAdapter);
		await client.start(() => {});

		// Trusted DM invite -> join (bootstrap).
		await adapter.invite(ROOM_A);
		expect(account.memberships.get(ROOM_A)).toBe("joined");

		// Untrusted invite -> decline (single client owns the account).
		await adapter.invite(ROOM_B, `@mallory:${HOME}`);
		expect(account.memberships.get(ROOM_B)).toBe("left");
	});

	it("still routes messages only to the room owner after a shared invite storm", async () => {
		const account = makeAccount();
		const a = await startAgent(account, ROOM_A, "A");
		const b = await startAgent(account, ROOM_B, "B");

		account.memberships.set(ROOM_A, "invited");
		account.memberships.set(ROOM_B, "invited");
		await a.adapter.emitInvite(ROOM_A);
		await b.adapter.emitInvite(ROOM_A);
		await b.adapter.emitInvite(ROOM_B);
		await a.adapter.emitInvite(ROOM_B);

		await a.adapter.emitMessage({ roomId: ROOM_A, eventId: "$a:1" });
		await a.adapter.emitMessage({ roomId: ROOM_B, eventId: "$b:1" });
		await b.adapter.emitMessage({ roomId: ROOM_B, eventId: "$b:1" });
		await b.adapter.emitMessage({ roomId: ROOM_A, eventId: "$a:1" });

		expect(a.inbound.map((m) => m.eventId)).toEqual(["$a:1"]);
		expect(b.inbound.map((m) => m.eventId)).toEqual(["$b:1"]);
		expect(account.memberships.get(ROOM_A)).toBe("joined");
		expect(account.memberships.get(ROOM_B)).toBe("joined");
	});
});
