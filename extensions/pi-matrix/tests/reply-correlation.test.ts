/**
 * Reply correlation tests (fake adapter).
 *
 * A GM answer should be thread-correlated to the message it answers, using the
 * same event id the model saw from message_read. Correlation is descriptive —
 * it is not authentication and grants nothing. Tests also pin that a message
 * the agent never saw (dropped by ingress limits) is never replied to.
 */

import { describe, expect, it } from "vitest";

import type {
	MatrixAdapterCallbacks,
	MatrixClientAdapter,
	MatrixInboundEvent,
} from "../adapter.js";
import { MatrixBridgeClient } from "../client.js";
import { markdownToMatrixContent } from "../markdown.js";
import { MatrixTransport } from "../transport.js";
import type { MatrixConfig } from "../types.js";

const HOME = "matrix.example.net";
const JIM = `@jim:${HOME}`;
const BOT = `@coas-bot:${HOME}`;
const ROOM = "!gm-one:matrix.example.net";

function makeConfig(): MatrixConfig {
	return {
		homeserver: `https://${HOME}`,
		userId: BOT,
		roomId: ROOM,
		accessToken: "dummy-fixture-token",
		storagePath: "/tmp/fake-sync",
		attachmentCachePath: "/tmp/fake-attachments",
		maxAttachmentBytes: 1024,
		allowedMimePrefixes: [],
		channelLabel: "matrix",
		trustedSenders: [JIM],
		allowAnySender: false,
		ingress: { maxBuffer: 1, overflowPolicy: "drop-newest" },
	};
}

function makeAdapter() {
	const adapter = {
		callbacks: undefined as unknown as MatrixAdapterCallbacks,
		sent: [] as Array<{ roomId: string; content: Record<string, unknown> }>,
		crypto: null,
		async start(_config: MatrixConfig, callbacks: MatrixAdapterCallbacks) {
			adapter.callbacks = callbacks;
		},
		async stop() {},
		async joinRoom() {},
		async leaveRoom() {},
		async sendMessage(roomId: string, content: Record<string, unknown>) {
			adapter.sent.push({ roomId, content });
			return { eventId: `$sent-${adapter.sent.length}` };
		},
		isConnected: () => true,
		async emit(event: Partial<MatrixInboundEvent> & { roomId: string; eventId: string }) {
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
	};
	return adapter;
}

type Adapter = ReturnType<typeof makeAdapter>;

async function start(adapter: Adapter) {
	const client = new MatrixBridgeClient(makeConfig(), adapter as unknown as MatrixClientAdapter);
	const transport = new MatrixTransport(client, "matrix", { maxBuffer: 1, overflowPolicy: "drop-newest" });
	await client.start((msg) => transport.pushInbound(msg));
	return transport;
}

const PEER = { id: "p", name: "jim", pid: 1, cwd: "/", model: "x", startedAt: 0, heartbeat: 0, status: "running" as const };

describe("matrix reply correlation", () => {
	it("threads one reply to the message that was read, then stops threading", async () => {
		const adapter = makeAdapter();
		const transport = await start(adapter);

		await adapter.emit({ roomId: ROOM, eventId: "$jim:1", content: { msgtype: "m.text", body: "question" } });
		const read = transport.receive("gm-one");
		expect(read.map((m) => m.id)).toEqual(["$jim:1"]);

		await transport.send(PEER, "gm-one", "answer");
		expect(adapter.sent).toHaveLength(1);
		expect(adapter.sent[0]?.roomId).toBe(ROOM);
		expect(adapter.sent[0]?.content).toMatchObject({
			"m.relates_to": { "m.in_reply_to": { event_id: "$jim:1" } },
		});

		// A later proactive message is not falsely threaded to the old question.
		await transport.send(PEER, "gm-one", "follow-up");
		expect(adapter.sent[1]?.content).not.toHaveProperty("m.relates_to");
	});

	it("never threads to a message the agent did not receive", async () => {
		const adapter = makeAdapter();
		const transport = await start(adapter);

		await adapter.emit({ roomId: ROOM, eventId: "$kept:1" });
		await adapter.emit({ roomId: ROOM, eventId: "$dropped:2" }); // buffer full: dropped
		expect(transport.receive("gm-one").map((m) => m.id)).toEqual(["$kept:1"]);

		await transport.send(PEER, "gm-one", "answer");
		expect(adapter.sent[0]?.content).toMatchObject({
			"m.relates_to": { "m.in_reply_to": { event_id: "$kept:1" } },
		});
	});

	it("keeps the plain text content intact alongside the relation", () => {
		const content = markdownToMatrixContent("**done**", { inReplyTo: "$x:1" });
		expect(content.body).toContain("done");
		expect(content.formatted_body).toContain("<strong>done</strong>");
		expect(content["m.relates_to"]).toEqual({ "m.in_reply_to": { event_id: "$x:1" } });
		expect(markdownToMatrixContent("plain")).not.toHaveProperty("m.relates_to");
	});
});
