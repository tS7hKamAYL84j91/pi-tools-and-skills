/**
 * Native Matrix pills (`m.mentions.user_ids`) in the shared EO Leads room.
 *
 * All leads currently authenticate as one Matrix account, so a pill for that
 * account would address every lead. Native acceptance is therefore driven by
 * per-agent identities declared in config (`mentionUserIds`), and it only ever
 * *adds* an address for an id this agent owns — sender trust, room binding and
 * permissions are unchanged. Anything not positively addressed stays silent.
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
import { addressesOwnUserIds, mentionedUserIds } from "../mention.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const SHARED_ACCOUNT = `@coas-bot:${HOME}`;
const LEAD_A = `@lead-a:${HOME}`;
const LEAD_B = `@lead-b:${HOME}`;
const SHARED = "!eo-leads:matrix.example.net";
const PRIVATE_A = "!lead-a-room:matrix.example.net";

const PEER = {
	id: "p",
	name: "jim",
	pid: 1,
	cwd: "/",
	model: "x",
	startedAt: 0,
	heartbeat: 0,
	status: "running" as const,
};

function makeConfig(options: {
	roomId?: string;
	mentionUserIds?: string[];
	mentionNames?: string[];
} = {}): MatrixConfig {
	return {
		homeserver: `https://${HOME}`,
		userId: SHARED_ACCOUNT,
		roomId: options.roomId ?? PRIVATE_A,
		sharedRoomId: SHARED,
		mentionNames: options.mentionNames ?? ["lead-a"],
		mentionAll: true,
		mentionUserIds: options.mentionUserIds ?? [LEAD_A],
		accessToken: "dummy-fixture-token",
		storagePath: "/tmp/fake-userid-mentions",
		attachmentCachePath: "/tmp/fake-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: [],
		channelLabel: "matrix",
		trustedSenders: [JIM],
		allowAnySender: false,
		ingress: {},
	};
}

function makeAdapter() {
	const adapter = {
		callbacks: undefined as unknown as MatrixAdapterCallbacks,
		sent: [] as Array<{ roomId: string; body: string; relatesTo?: unknown }>,
		crypto: null,
		async start(_config: MatrixConfig, callbacks: MatrixAdapterCallbacks) {
			adapter.callbacks = callbacks;
		},
		async stop() {},
		async joinRoom() {},
		async leaveRoom() {},
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
	};
	return adapter;
}

async function startAgent(config = makeConfig()) {
	const adapter = makeAdapter();
	const client = new MatrixBridgeClient(config, adapter as unknown as MatrixClientAdapter);
	const transport = new MatrixTransport(client);
	const inbound = vi.fn();
	await client.start((msg) => {
		inbound(msg);
		transport.pushInbound(msg);
	});
	return { adapter, client, transport, inbound };
}

function pill(body: string, userIds: string[]): Record<string, unknown> {
	return { msgtype: "m.text", body, "m.mentions": { user_ids: userIds } };
}

describe("m.mentions parsing", () => {
	it("reads user_ids verbatim and ignores malformed content", () => {
		expect(mentionedUserIds(pill("hi", [LEAD_A]))).toEqual([LEAD_A]);
		// Verbatim: no case folding, no trimming of server-supplied ids.
		expect(mentionedUserIds(pill("hi", [LEAD_A.toUpperCase()]))).toEqual([LEAD_A.toUpperCase()]);
		expect(mentionedUserIds({ body: "no mentions" })).toEqual([]);
		expect(mentionedUserIds({ "m.mentions": { user_ids: "not-an-array" } })).toEqual([]);
		expect(mentionedUserIds({ "m.mentions": { user_ids: [1, null, ""] } })).toEqual([]);
		expect(mentionedUserIds(undefined)).toEqual([]);
	});

	it("matches only exact owned ids and rejects junk identities", () => {
		expect(addressesOwnUserIds([LEAD_A], [LEAD_A])).toBe(true);
		expect(addressesOwnUserIds([LEAD_B], [LEAD_A])).toBe(false);
		expect(addressesOwnUserIds([LEAD_A], [])).toBe(false);
		expect(addressesOwnUserIds([], [LEAD_A])).toBe(false);
		expect(addressesOwnUserIds([LEAD_B], ["not-an-mxid"])).toBe(false);
		expect(addressesOwnUserIds([LEAD_A, LEAD_B], [LEAD_B])).toBe(true);
	});

	it("does not treat a case-different MXID as the same principal", () => {
		expect(addressesOwnUserIds(["@Lead-A:matrix.example.net"], [LEAD_A])).toBe(false);
		expect(addressesOwnUserIds([LEAD_A], ["@Lead-A:matrix.example.net"])).toBe(false);
		// Same localpart and server, only the case differs: still not an address.
		expect(mentionedUserIds(pill("hi", ["@LEAD-A:matrix.example.net"]))).toEqual([
			"@LEAD-A:matrix.example.net",
		]);
	});
});

describe("shared-room native pills", () => {
	it("delivers a pill naming this lead's own id and replies in the shared room", async () => {
		const { adapter, transport } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$pill:1",
			content: pill("Jim used a pill", [LEAD_A]),
		});
		expect(transport.receive("a").map((m) => m.id)).toEqual(["$pill:1"]);

		await transport.send(PEER, "lead-a", "answered in shared room");
		expect(adapter.sent).toHaveLength(1);
		expect(adapter.sent[0]?.roomId).toBe(SHARED);
		expect(adapter.sent[0]?.relatesTo).toBe("$pill:1");
	});

	it("never wakes on another lead's pill", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$other:1",
			content: pill("for lead B", [LEAD_B]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("never wakes on the shared account's own pill (that would address every lead)", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$shared:1",
			content: pill("pill for the shared bot", [SHARED_ACCOUNT]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("keeps a genuinely unmentioned shared message silent", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$none:1",
			content: { msgtype: "m.text", body: "general chatter" },
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("retains literal aliases and @all alongside native pills", async () => {
		const { adapter, transport } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$alias:1",
			content: { msgtype: "m.text", body: "@lead-a text mention" },
		});
		await adapter.emit({
			roomId: SHARED,
			eventId: "$all:1",
			content: { msgtype: "m.text", body: "@all standup" },
		});
		expect(transport.receive("a").map((m) => m.id)).toEqual(["$alias:1", "$all:1"]);
	});

	it("keeps the trusted-sender gate: an untrusted pill is dropped", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$mallory:1",
			sender: `@mallory:${HOME}`,
			content: pill("trust me", [LEAD_A]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("suppresses this account's own pill echo", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: SHARED,
			eventId: "$echo:1",
			sender: SHARED_ACCOUNT,
			content: pill("my own pill", [LEAD_A]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("leaves private-room delivery unchanged (no mention required)", async () => {
		const { adapter, transport } = await startAgent();

		await adapter.emit({
			roomId: PRIVATE_A,
			eventId: "$private:1",
			content: { msgtype: "m.text", body: "no mention here" },
		});
		expect(transport.receive("a").map((m) => m.id)).toEqual(["$private:1"]);
	});

	it("stays silent by default when no per-agent ids are configured", async () => {
		const { adapter, transport, inbound } = await startAgent(
			makeConfig({ mentionUserIds: [] }),
		);

		await adapter.emit({
			roomId: SHARED,
			eventId: "$pill:1",
			content: pill("pill for shared id", [SHARED_ACCOUNT]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});

	it("does not count a pill in a room other than the bound or shared room", async () => {
		const { adapter, transport, inbound } = await startAgent();

		await adapter.emit({
			roomId: "!some-other-room:matrix.example.net",
			eventId: "$foreign:1",
			content: pill("for lead A", [LEAD_A]),
		});
		expect(inbound).not.toHaveBeenCalled();
		expect(transport.pendingCount("a")).toBe(0);
	});
});
