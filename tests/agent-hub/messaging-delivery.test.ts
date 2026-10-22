/**
 * Delivery tests for the notification ("poke") path.
 *
 * A poke is only useful if it reaches an idle AND a busy agent, and if a
 * notification that is never consumed (failed injection, model ends its turn
 * without message_read) is retried instead of staying stuck above the
 * notified count. All transports here are fakes; no Matrix/homeserver.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { InboundMessage, MessageTransport } from "../../lib/message-transport.js";
import type { AgentRecord } from "../../lib/agent-registry.js";
import { registerChannel, unregisterChannel } from "../../lib/message-transport.js";
import { MessagingCore } from "../../extensions/pi-agent-hub/messaging/messaging-core.js";
import type { Registry } from "../../extensions/pi-agent-hub/types.js";

const SELF: AgentRecord = {
	id: "self-1",
	name: "gm",
	pid: 111,
	cwd: "/tmp/gm",
	model: "fake/model",
	startedAt: Date.now() - 1000,
	heartbeat: Date.now(),
	status: "running",
};

function makeTransport(): MessageTransport & {
	push: (msg: InboundMessage) => void;
	pending: InboundMessage[];
} {
	const pending: InboundMessage[] = [];
	return {
		pending,
		push(msg) {
			pending.push(msg);
		},
		async send() {
			return { accepted: true, immediate: true };
		},
		receive() {
			const all = [...pending];
			pending.length = 0;
			return all;
		},
		ack() {},
		prune() {},
		init() {},
		pendingCount() {
			return pending.length;
		},
		cleanup() {},
	};
}

function makeRegistry(): Registry {
	return {
		selfId: SELF.id,
		getRecord: vi.fn(() => SELF),
		register: vi.fn(),
		unregister: vi.fn(),
		setStatus: vi.fn(),
		updateModel: vi.fn(),
		setTask: vi.fn(),
		setName: vi.fn(),
		updatePendingMessages: vi.fn(),
		setExternalPeers: vi.fn(),
		readAllPeers: vi.fn(() => [SELF]),
		flush: vi.fn(),
		isRootSession: vi.fn(() => true),
	} as unknown as Registry;
}

function makeContext(isIdle: boolean): ExtensionContext {
	return {
		isIdle: vi.fn(() => isIdle),
		hasUI: false,
		cwd: "/tmp/gm",
		ui: { notify: vi.fn(), setStatus: vi.fn() },
	} as unknown as ExtensionContext;
}

let transport: ReturnType<typeof makeTransport>;
let sendUserMessage: ReturnType<typeof vi.fn>;
let core: MessagingCore;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
	transport = makeTransport();
	sendUserMessage = vi.fn();
	registerChannel("matrix", transport);
	core = new MessagingCore(
		{ sendUserMessage } as unknown as ExtensionAPI,
		makeRegistry(),
		{ send: transport, broadcast: transport },
	);
});

afterEach(() => {
	core.dispose();
	unregisterChannel("matrix");
	vi.useRealTimers();
});

function setContext(isIdle: boolean): void {
	core.setContext(makeContext(isIdle));
}

function pokeCount(): number {
	return sendUserMessage.mock.calls.length;
}

describe("message notification delivery", () => {
	it("pokes an idle agent immediately when a channel notifies", () => {
		setContext(true);
		transport.push({ id: "$1", from: "matrix:jim", text: "hi", ts: Date.now() });
		core.schedulePoke();
		vi.advanceTimersByTime(2_000);

		expect(pokeCount()).toBe(1);
		expect(sendUserMessage).toHaveBeenCalledWith(
			expect.stringContaining("1 new message"),
			{ deliverAs: "followUp" },
		);
	});

	it("pokes a busy agent too, queuing a follow-up instead of waiting for idle", () => {
		setContext(false);
		transport.push({ id: "$1", from: "matrix:jim", text: "hi", ts: Date.now() });
		core.schedulePoke();
		vi.advanceTimersByTime(2_000);

		expect(pokeCount()).toBe(1);
		expect(sendUserMessage.mock.calls[0]?.[1]).toEqual({ deliverAs: "followUp" });
	});

	it("does not stack one queued notification per arriving message", () => {
		setContext(false);
		transport.push({ id: "$1", from: "matrix:jim", text: "one", ts: Date.now() });
		core.schedulePoke();
		vi.advanceTimersByTime(2_000);

		transport.push({ id: "$2", from: "matrix:jim", text: "two", ts: Date.now() });
		core.schedulePoke();
		vi.advanceTimersByTime(5_000);

		expect(pokeCount()).toBe(1);
	});

	it("retries a notification that was never consumed", () => {
		setContext(true);
		transport.push({ id: "$1", from: "matrix:jim", text: "hi", ts: Date.now() });
		core.pokeNow();
		expect(pokeCount()).toBe(1);

		// Pending stays above zero: the model ended its turn without message_read.
		core.schedulePoke();
		vi.advanceTimersByTime(30_000);

		expect(pokeCount()).toBe(2);
	});

	it("pokes immediately again once the outstanding messages are read", () => {
		setContext(true);
		transport.push({ id: "$1", from: "matrix:jim", text: "hi", ts: Date.now() });
		core.pokeNow();
		expect(core.drainAllChannels()).toHaveLength(1);

		transport.push({ id: "$2", from: "matrix:jim", text: "again", ts: Date.now() });
		core.schedulePoke();
		vi.advanceTimersByTime(2_000);

		expect(pokeCount()).toBe(2);
		expect(sendUserMessage.mock.calls[1]?.[0]).toContain("1 new message");
	});

	it("does not poke when nothing is pending", () => {
		setContext(true);
		core.schedulePoke();
		vi.advanceTimersByTime(60_000);
		expect(pokeCount()).toBe(0);
	});

	it("recovers when injection throws", () => {
		setContext(true);
		transport.push({ id: "$1", from: "matrix:jim", text: "hi", ts: Date.now() });
		sendUserMessage.mockImplementationOnce(() => {
			throw new Error("compaction in progress");
		});
		core.pokeNow();
		expect(pokeCount()).toBe(1);

		core.schedulePoke();
		vi.advanceTimersByTime(30_000);
		expect(pokeCount()).toBe(2);
	});
});
