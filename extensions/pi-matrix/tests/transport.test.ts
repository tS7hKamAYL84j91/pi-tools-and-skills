/** Tests for MatrixTransport ingress limits and overflow behavior. */

import { describe, expect, it, vi } from "vitest";

import { MatrixTransport } from "../transport.js";
import type { MatrixBridgeClient } from "../client.js";

function createClient() {
	return {
		send: vi.fn(async () => ({ eventId: "$outbound:example" })),
		sendTo: vi.fn(async () => ({ eventId: "$outbound:example" })),
		isConnected: vi.fn(() => true),
	};
}

function createInbound(sender: string, eventId: string, body = "hello") {
	return {
		roomId: "!room:example",
		senderMxid: sender,
		body,
		eventId,
		timestampMs: Date.now(),
	};
}

describe("MatrixTransport", () => {
	it("buffers and returns inbound messages", () => {
		const transport = new MatrixTransport(createClient() as unknown as MatrixBridgeClient);
		transport.pushInbound(createInbound("@alice:example", "$a:1"));
		transport.pushInbound(createInbound("@bob:example", "$b:1"));

		const received = transport.receive("");
		expect(received).toHaveLength(2);
		expect(received[0]?.id).toBe("$a:1");
		expect(received[1]?.id).toBe("$b:1");
		expect(transport.pendingCount("")).toBe(0);
	});

	it("drops newest messages when the buffer overflows", () => {
		const warnings: string[] = [];
		const transport = new MatrixTransport(
			createClient() as unknown as MatrixBridgeClient,
			"matrix",
			{ maxBuffer: 2, overflowPolicy: "drop-newest" },
			(msg) => warnings.push(msg),
		);

		transport.pushInbound(createInbound("@alice:example", "$a:1"));
		transport.pushInbound(createInbound("@alice:example", "$a:2"));
		transport.pushInbound(createInbound("@alice:example", "$a:3"));

		const received = transport.receive("");
		expect(received.map((m) => m.id)).toEqual(["$a:1", "$a:2"]);
		expect(transport.limiterCounters().overflowed).toBe(1);
		expect(warnings.some((w) => w.includes("dropped 1 message") && w.includes("overflow"))).toBe(true);
	});

	it("evicts oldest messages when overflow policy is drop-oldest", () => {
		const warnings: string[] = [];
		const transport = new MatrixTransport(
			createClient() as unknown as MatrixBridgeClient,
			"matrix",
			{ maxBuffer: 2, overflowPolicy: "drop-oldest" },
			(msg) => warnings.push(msg),
		);

		transport.pushInbound(createInbound("@alice:example", "$a:1"));
		transport.pushInbound(createInbound("@alice:example", "$a:2"));
		transport.pushInbound(createInbound("@alice:example", "$a:3"));

		const received = transport.receive("");
		expect(received.map((m) => m.id)).toEqual(["$a:2", "$a:3"]);
		expect(transport.limiterCounters().overflowed).toBe(1);
		expect(warnings.length).toBeGreaterThan(0);
	});

	it("enforces a global burst limit with recovery after the window", () => {
		const warnings: string[] = [];
		const transport = new MatrixTransport(
			createClient() as unknown as MatrixBridgeClient,
			"matrix",
			{ globalBurstLimit: 2, rateWindowMs: 100 },
			(msg) => warnings.push(msg),
		);

		transport.pushInbound(createInbound("@alice:example", "$a:1", "one"));
		transport.pushInbound(createInbound("@bob:example", "$b:1", "two"));
		transport.pushInbound(createInbound("@carol:example", "$c:1", "three"));

		expect(transport.receive("").map((m) => m.id)).toEqual(["$a:1", "$b:1"]);
		const counters = transport.limiterCounters();
		expect(counters.droppedGlobal).toBe(1);
		expect(counters.droppedSender).toBe(0);
		expect(warnings.some((w) => w.includes("global rate limit"))).toBe(true);

		// Simulate window expiry and accept again.
		transport.pushInbound({ ...createInbound("@dave:example", "$d:1"), timestampMs: Date.now() + 200 });
		expect(transport.receive("").map((m) => m.id)).toEqual(["$d:1"]);
	});

	it("isolates per-sender limits from other senders", () => {
		const warnings: string[] = [];
		const transport = new MatrixTransport(
			createClient() as unknown as MatrixBridgeClient,
			"matrix",
			{ perSenderBurstLimit: 2, rateWindowMs: 10_000 },
			(msg) => warnings.push(msg),
		);

		transport.pushInbound(createInbound("@alice:example", "$a:1"));
		transport.pushInbound(createInbound("@alice:example", "$a:2"));
		transport.pushInbound(createInbound("@alice:example", "$a:3"));
		transport.pushInbound(createInbound("@bob:example", "$b:1"));

		const received = transport.receive("");
		expect(received.map((m) => m.id)).toEqual(["$a:1", "$a:2", "$b:1"]);
		expect(transport.limiterCounters().droppedSender).toBe(1);
		expect(warnings.some((w) => w.includes("per-sender rate limit"))).toBe(true);
	});

	it("emits redacted diagnostics without message bodies", () => {
		const warnings: string[] = [];
		const transport = new MatrixTransport(
			createClient() as unknown as MatrixBridgeClient,
			"matrix",
			{ maxBuffer: 1, overflowPolicy: "drop-newest" },
			(msg) => warnings.push(msg),
		);

		transport.pushInbound(createInbound("@alice:example", "$a:1", "secret body content"));
		transport.pushInbound(createInbound("@alice:example", "$a:2", "more secret content"));

		transport.receive("");
		for (const warning of warnings) {
			expect(warning).not.toContain("secret body content");
			expect(warning).not.toContain("more secret content");
			expect(warning).not.toContain("@alice:example");
		}
	});
});
