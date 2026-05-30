/**
 * Messaging core logic for pi-panopticon.
 * Encapsulates poke debouncing, inbox watching, and channel draining.
 */

import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { REGISTRY_DIR } from "../../../lib/agent-registry.js";
import { getChannels } from "../../../lib/message-transport.js";
import type { InboundMessage } from "../../../lib/message-transport.js";
import type { Registry } from "../types.js";
import type { MessagingConfig } from "./messaging-config.js";

export interface ChannelMessage extends InboundMessage {
	channel: string;
}

export class MessagingCore {
	private extensionCtx: ExtensionContext | null = null;
	private pokeTimeout: ReturnType<typeof setTimeout> | null = null;
	private inboxWatcher: FSWatcher | null = null;

	constructor(
		private pi: ExtensionAPI,
		private registry: Registry,
		private config: MessagingConfig
	) {}

	setContext(ctx: ExtensionContext) {
		this.extensionCtx = ctx;
	}

	totalPending(): number {
		const record = this.registry.getRecord();
		if (!record) return 0;
		let count = 0;
		for (const [, transport] of getChannels()) {
			count += transport.pendingCount(record.id);
		}
		return count;
	}

	schedulePoke(): void {
		if (this.pokeTimeout) return;
		this.pokeTimeout = setTimeout(() => {
			this.pokeTimeout = null;
			const count = this.totalPending();
			if (count === 0) return;
			if (!this.extensionCtx?.isIdle()) {
				this.schedulePoke();
				return;
			}
			this.pi.sendUserMessage(
				`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
				{ deliverAs: "followUp" },
			);
		}, 2000);
	}

	pokeNow(): void {
		const count = this.totalPending();
		if (count === 0) return;
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
		this.pi.sendUserMessage(
			`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
			{ deliverAs: "followUp" },
		);
	}

	drainAllChannels(): ChannelMessage[] {
		const record = this.registry.getRecord();
		if (!record) return [];
		const all: ChannelMessage[] = [];
		for (const [name, transport] of getChannels()) {
			const pending = transport.receive(record.id);
			for (const msg of pending) {
				all.push({ ...msg, channel: name });
				if (name === "agent") this.config.onMessage?.(msg.text);
				transport.ack(record.id, msg.id);
			}
			if (pending.length > 0) transport.prune(record.id);
		}
		return all;
	}

	updatePendingCount(): void {
		const record = this.registry.getRecord();
		if (!record) return;
		const count = this.totalPending();
		if (record.pendingMessages !== count) {
			this.registry.updatePendingMessages(count);
		}
	}

	startWatcher(): void {
		const record = this.registry.getRecord();
		if (!record) return;
		this.inboxWatcher?.close();
		try {
			const newDir = join(REGISTRY_DIR, record.id, "inbox", "new");
			this.inboxWatcher = watch(newDir, () => this.schedulePoke());
			this.inboxWatcher.unref();
		} catch { /* best-effort: dir may not exist yet */ }
	}

	dispose(): void {
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
		this.inboxWatcher?.close();
		this.inboxWatcher = null;
	}
}
