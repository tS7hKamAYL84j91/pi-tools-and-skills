/** Inbox wakeups use count-only prompts and survive missed filesystem events. */
import { EventEmitter } from "node:events";
import { watch, type FSWatcher } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessagingCore } from "../../extensions/pi-panopticon/messaging/messaging-core.js";
import { registerChannel, unregisterChannel, type MessageTransport } from "../../lib/message-transport.js";
import { asExtensionApi, makeAgentRecord, makeMockContext, makeMockExtensionApi, makeRegistry } from "./helpers.js";

vi.mock("node:fs", async (original) => ({
	...await original<typeof import("node:fs")>(),
	watch: vi.fn(),
}));

function fakeWatcher() {
	const watcher = Object.assign(new EventEmitter(), {
		close: vi.fn(() => { watcher.emit("close"); }),
		ref: vi.fn(),
		unref: vi.fn(),
	});
	return watcher;
}

function fixture() {
	let pending = 1;
	const api = makeMockExtensionApi();
	const ctx = makeMockContext();
	const transport: MessageTransport = {
		send: async () => ({ accepted: true, immediate: false }),
		receive: vi.fn(() => pending ? [{ id: "1.json", from: "peer", text: "private body", ts: 1 }] : []),
		ack: () => { pending = 0; },
		prune: () => {},
		init: () => {},
		pendingCount: () => pending,
		cleanup: () => {},
	};
	registerChannel("agent", transport);
	const core = new MessagingCore(asExtensionApi(api), makeRegistry(makeAgentRecord()), { send: transport, broadcast: transport });
	core.setContext(ctx as unknown as ExtensionContext);
	cores.push(core);
	return { core, api, ctx, transport, setPending: (count: number) => { pending = count; } };
}

const cores: MessagingCore[] = [];
let watcher: ReturnType<typeof fakeWatcher>;
beforeEach(() => {
	vi.useFakeTimers();
	watcher = fakeWatcher();
	vi.mocked(watch).mockReset().mockReturnValue(watcher as unknown as FSWatcher);
});
afterEach(() => {
	for (const core of cores.splice(0)) core.dispose();
	unregisterChannel("agent");
	vi.useRealTimers();
});

describe("Panopticon inbox wakeups", () => {
	it("debounces bursts and wakes an idle agent without reading message bodies", () => {
		const { core, api, transport } = fixture();
		core.startWatcher();
		const listener = vi.mocked(watch).mock.calls[0]?.[1];
		if (typeof listener !== "function") throw new Error("watch listener missing");
		listener("rename", "1.json");
		listener("rename", "1.json");
		vi.advanceTimersByTime(2000);
		expect(api.sendUserMessage).toHaveBeenCalledExactlyOnceWith("1 new message. Use message_read to see it.", { deliverAs: "followUp" });
		expect(transport.receive).not.toHaveBeenCalled();
	});

	it("defers while busy and injects once idle without another filesystem event", () => {
		const { core, api, ctx } = fixture();
		ctx.isIdle.mockReturnValue(false);
		core.schedulePoke();
		vi.advanceTimersByTime(4000);
		expect(api.sendUserMessage).not.toHaveBeenCalled();
		ctx.isIdle.mockReturnValue(true);
		vi.advanceTimersByTime(2000);
		expect(api.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("recovers a failed watcher setup and still wakes for unread mail", () => {
		vi.mocked(watch).mockImplementationOnce(() => { throw new Error("watch unavailable"); });
		const { core, api } = fixture();
		core.startWatcher();
		vi.advanceTimersByTime(7000);
		expect(watch).toHaveBeenCalledTimes(2);
		expect(api.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("finds unread mail even when a live watcher misses the event", () => {
		const { core, api, setPending } = fixture();
		setPending(0);
		core.startWatcher();
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).not.toHaveBeenCalled();
		setPending(2);
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).toHaveBeenCalledExactlyOnceWith("2 new messages. Use message_read to see them.", { deliverAs: "followUp" });
	});

	it.each(["error", "close"])("reattaches after watcher %s without losing the wakeup", (event) => {
		const { core, api } = fixture();
		core.startWatcher();
		const replacement = fakeWatcher();
		vi.mocked(watch).mockReturnValue(replacement as unknown as FSWatcher);
		expect(() => watcher.emit(event, new Error("watch unavailable"))).not.toThrow();
		vi.advanceTimersByTime(7000);
		expect(watch).toHaveBeenCalledTimes(2);
		expect(api.sendUserMessage).toHaveBeenCalledOnce();
	});

	it("does not queue duplicate reminders, and rearms after message_read drains mail", () => {
		const { core, api, setPending } = fixture();
		core.startWatcher();
		core.pokeNow();
		core.pokeNow();
		vi.advanceTimersByTime(20_000);
		expect(api.sendUserMessage).toHaveBeenCalledOnce();
		core.drainAllChannels();
		setPending(1);
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).toHaveBeenCalledTimes(2);
	});

	it("notifies for new arrivals even when earlier mail is still unread", () => {
		const { core, api, setPending } = fixture();
		core.startWatcher();
		core.pokeNow();
		setPending(2);
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(api.sendUserMessage).toHaveBeenLastCalledWith("2 new messages. Use message_read to see them.", { deliverAs: "followUp" });
	});

	it("does not wake for mail drained before the debounce finishes", () => {
		const { core, api } = fixture();
		core.startWatcher();
		core.schedulePoke();
		core.drainAllChannels();
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).not.toHaveBeenCalled();
	});

	it("keeps repeated initialization idempotent", () => {
		const { core } = fixture();
		core.startWatcher();
		core.startWatcher();
		expect(watch).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(1);
	});

	it("retries a failed prompt injection without losing unread mail", () => {
		const { core, api, transport } = fixture();
		api.sendUserMessage.mockImplementationOnce(() => { throw new Error("temporarily unavailable"); });
		core.startWatcher();
		expect(() => core.pokeNow()).not.toThrow();
		vi.advanceTimersByTime(7000);
		expect(api.sendUserMessage).toHaveBeenCalledTimes(2);
		expect(transport.receive).not.toHaveBeenCalled();
	});

	it("stops timers, watcher recovery and late callbacks on disposal", () => {
		const { core, api } = fixture();
		core.startWatcher();
		core.schedulePoke();
		core.dispose();
		core.schedulePoke();
		core.pokeNow();
		vi.advanceTimersByTime(20_000);
		expect(api.sendUserMessage).not.toHaveBeenCalled();
		expect(watcher.close).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(0);
	});
});
