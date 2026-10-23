/**
 * Shared EO Leads room with logical mention-only routing.
 *
 * All leads are the same Matrix user, so "mention the bot" notifies everyone.
 * These fixtures use one account state behind two clients: a shared-room message
 * must be delivered (and answered) only by the mentioned lead, an unmentioned
 * message must reach nobody (no buffer, no notification), while each lead's
 * private room keeps working exactly as before.
 *
 * Fake adapter/account only: no homeserver, token or live room.
 */

import { describe, expect, it, vi } from "vitest";

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
} from "../adapter.js";
import { MatrixBridgeClient } from "../client.js";
import { MatrixTransport } from "../transport.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const BOT = `@coas-bot:${HOME}`;
const SHARED = "!eo-leads:matrix.example.net";
const PRIVATE_A = "!lead-a:matrix.example.net";
const PRIVATE_B = "!lead-b:matrix.example.net";

type Membership = "invited" | "joined" | "left";

function makeAccount() {
	return {
		memberships: new Map<string, Membership>(),
		log: [] as string[],
	};
}
type Account = ReturnType<typeof makeAccount>;

function makeConfig(roomId: string, mentions: string[]): MatrixConfig {
	return {
		homeserver: `https://${HOME}`,
		userId: BOT,
		roomId,
		sharedRoomId: SHARED,
		mentionNames: mentions,
		mentionAll: true,
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
		sent: [] as Array<{ roomId: string; body: string; relatesTo?: unknown }>,
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
			account.memberships.set(roomId, "left");
			account.log.push(`${label}:leave:${roomId}`);
		},
		async sendMessage(roomId: string, content: Record<string, unknown>) {
			const relates = content["m.relates_to"] as
				| { "m.in_reply_to": { event_id: string } }
				| undefined;
			adapter.sent.push({
				roomId,
				body: String(content.body ?? ""),
				relatesTo: relates?.["m.in_reply_to"]?.event_id,
			});
			return { eventId: `$sent-${adapter.sent.length}` };
		},
		isConnected: () => true,
		async emit(event: Partial<MatrixInboundEvent> & { roomId: string; eventId: string }) {
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
		async text(roomId: string, body: string, eventId: string) {
			await adapter.emit({ roomId, eventId, content: { msgtype: "m.text", body } });
		},
	};
	return adapter;
}
async function startAgent(account: Account, roomId: string, mentions: string[], label: string) {
	const adapter = makeAdapter(account, label);
	const client = new MatrixBridgeClient(makeConfig(roomId, mentions), adapter as unknown as MatrixClientAdapter);
	const transport = new MatrixTransport(client);
	await client.start((msg) => transport.pushInbound(msg));
	return { adapter, client, transport };
}

const PEER = { id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" as const };

describe("shared EO Leads room, mention-only", () => {
	it("delivers a mentioned message only to the mentioned lead", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a", "gemma"], "A");
		const b = await startAgent(account, PRIVATE_B, ["lead-b"], "B");

		await a.adapter.text(SHARED, "@lead-a please check the bank", "$m:1");
		await b.adapter.text(SHARED, "@lead-a please check the bank", "$m:1");

		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$m:1"]);
		expect(b.transport.receive("b")).toEqual([]);
	});

	it("delivers and answers in the shared room, not the private one", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a"], "A");

		await a.adapter.text(SHARED, "@lead-a answer here", "$m:1");
		const read = a.transport.receive("a");
		expect(read.map((m) => m.id)).toEqual(["$m:1"]);

		await a.transport.send(PEER, "lead-a", "shared reply");
		expect(a.adapter.sent).toHaveLength(1);
		expect(a.adapter.sent[0]?.roomId).toBe(SHARED);
		expect(a.adapter.sent[0]?.relatesTo).toBe("$m:1");
	});

	it("keeps private-room behaviour unchanged (no mention needed, reply in private room)", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a"], "A");

		await a.adapter.text(PRIVATE_A, "no mention in my private room", "$p:1");
		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$p:1"]);

		await a.transport.send(PEER, "lead-a", "private reply");
		expect(a.adapter.sent[0]?.roomId).toBe(PRIVATE_A);
		expect(a.adapter.sent[0]?.relatesTo).toBe("$p:1");
	});

	it("is silent for an unmentioned shared message: no buffer, no notification", async () => {
		const account = makeAccount();
		const adapter = makeAdapter(account, "A");
		const client = new MatrixBridgeClient(
			makeConfig(PRIVATE_A, ["lead-a"]),
			adapter as unknown as MatrixClientAdapter,
		);
		const transport = new MatrixTransport(client);
		const inbound = vi.fn();
		await client.start((msg) => {
			inbound();
			transport.pushInbound(msg);
		});

		await adapter.text(SHARED, "general chatter with no mention", "$m:1");
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("notifies every lead for @all and each mentioned lead for multi-target", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a"], "A");
		const b = await startAgent(account, PRIVATE_B, ["lead-b"], "B");

		await a.adapter.text(SHARED, "@all standup in five", "$all:1");
		await b.adapter.text(SHARED, "@all standup in five", "$all:1");
		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$all:1"]);
		expect(b.transport.receive("b").map((m) => m.id)).toEqual(["$all:1"]);

		await a.adapter.text(SHARED, "@lead-a @lead-b sync", "$both:1");
		await b.adapter.text(SHARED, "@lead-a @lead-b sync", "$both:1");
		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$both:1"]);
		expect(b.transport.receive("b").map((m) => m.id)).toEqual(["$both:1"]);
	});

	it("matches mentions case-insensitively", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["Lead-A"], "A");
		await a.adapter.text(SHARED, "@LEAD-A ping", "$m:1");
		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$m:1"]);
	});

	it("ignores untrusted, own, historical and non-message events in the shared room", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a"], "A");

		await a.adapter.emit({ roomId: SHARED, eventId: "$state:1", content: { membership: "invite" } });
		await a.adapter.emit({ roomId: SHARED, eventId: "$own:1", isLocalEcho: true });
		await a.adapter.emit({ roomId: SHARED, eventId: "$old:1", isHistorical: true });
		await a.adapter.emit({
			roomId: SHARED,
			eventId: "$bad:1",
			sender: `@mallory:${HOME}`,
			content: { msgtype: "m.text", body: "@lead-a hi" },
		});
		// A genuine mention still arrives.
		await a.adapter.text(SHARED, "@lead-a real", "$ok:1");

		expect(a.transport.receive("a").map((m) => m.id)).toEqual(["$ok:1"]);
	});

	it("does not accept a foreign room even when it mentions the lead", async () => {
		const account = makeAccount();
		const a = await startAgent(account, PRIVATE_A, ["lead-a"], "A");
		await a.adapter.text("!someone-else:matrix.example.net", "@lead-a hijack", "$x:1");
		expect(a.transport.receive("a")).toEqual([]);
	});
});
