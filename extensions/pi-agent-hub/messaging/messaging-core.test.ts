/** Tests for messaging core channel draining. */

import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notifyChannel, onChannelNotify, registerChannel, unregisterChannel } from "../../../lib/message-transport.js";
import type { MessageTransport } from "../../../lib/message-transport.js";
import { MessagingCore } from "./messaging-core.js";
import type { Registry } from "../types.js";

function stubTransport(message: unknown): MessageTransport {
	return {
		send: async () => ({ accepted: true, immediate: false }),
		receive: () => [message as ReturnType<MessageTransport["receive"]>[number]],
		ack: () => {},
		prune: () => {},
		init: () => {},
		pendingCount: () => 1,
		cleanup: () => {},
	};
}

describe("MessagingCore", () => {
	it("does not retain a channel notification listener after disposal", () => {
		const listener = vi.fn();
		const dispose = onChannelNotify(listener);

		dispose();
		notifyChannel();

		expect(listener).not.toHaveBeenCalled();
	});

	it("normalizes missing message text before completion-signal parsing", () => {
		const channelName = "agent";
		const seen: string[] = [];
		registerChannel(channelName, stubTransport({ id: "1", from: "peer", ts: 1 }));
		try {
			const registry = {
				getRecord: () => ({ id: "agent-id" }),
				updatePendingMessages: () => {},
			} as unknown as Registry;
			const transport = stubTransport({});
			const core = new MessagingCore({} as ExtensionAPI, registry, {
				send: transport,
				broadcast: transport,
				onMessage: (text) => {
					seen.push(text);
				},
			});

			expect(core.drainAllChannels()).toEqual([
				expect.objectContaining({ channel: channelName, text: "" }),
			]);
			expect(seen).toEqual([""]);
		} finally {
			unregisterChannel(channelName);
		}
	});
});
