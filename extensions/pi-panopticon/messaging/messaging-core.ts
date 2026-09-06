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
	private pendingCheck: ReturnType<typeof setInterval> | null = null;
	private notifiedCount = 0;

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
		if (!this.extensionCtx || this.pokeTimeout || this.totalPending() <= this.notifiedCount) return;
		this.pokeTimeout = setTimeout(() => {
			this.pokeTimeout = null;
			const count = this.totalPending();
			if (count === 0) return;
			if (!this.extensionCtx?.isIdle()) {
				this.schedulePoke();
				return;
			}
			this.pokeNow();
		}, 2000);
	}

	pokeNow(): void {
		if (!this.extensionCtx) return;
		const count = this.totalPending();
		if (count <= this.notifiedCount) return;
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
		const previousCount = this.notifiedCount;
		this.notifiedCount = count;
		try {
			this.pi.sendUserMessage(
				`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
				{ deliverAs: "followUp" },
			);
		} catch {
			// Keep mail unread and retry a transient injection failure.
			this.notifiedCount = previousCount;
			this.schedulePoke();
		}
	}

	drainAllChannels(): ChannelMessage[] {
		this.notifiedCount = 0;
		const record = this.registry.getRecord();
		if (!record) return [];
		const all: ChannelMessage[] = [];
		for (const [name, transport] of getChannels()) {
			const pending = transport.receive(record.id);
			for (const msg of pending) {
				const text = typeof msg.text === "string" ? msg.text : "";
				const normalizedMsg = { ...msg, text };
				all.push({ ...normalizedMsg, channel: name });
				if (name === "agent") this.config.onMessage?.(text);
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
		if (!this.extensionCtx || !this.registry.getRecord()) return;
		this.attachWatcher();
		// fs.watch may miss events or lose its directory. Check counts only;
		// message_read still owns reading and acknowledging message bodies.
		this.pendingCheck ??= setInterval(() => {
			this.attachWatcher();
			this.updatePendingCount();
			if (this.totalPending() === 0) this.notifiedCount = 0;
			else this.schedulePoke();
		}, 5000);
		this.pendingCheck.unref();
	}

	private attachWatcher(): void {
		const record = this.registry.getRecord();
		if (!this.extensionCtx || !record || this.inboxWatcher) return;
		try {
			const newDir = join(REGISTRY_DIR, record.id, "inbox", "new");
			const watcher = watch(newDir, () => this.schedulePoke());
			this.inboxWatcher = watcher;
			watcher.on("close", () => {
				if (this.inboxWatcher === watcher) this.inboxWatcher = null;
			});
			watcher.on("error", () => {
				if (this.inboxWatcher === watcher) this.inboxWatcher = null;
				watcher.close();
			});
			watcher.unref();
		} catch { /* periodic unread checks remain active and retry watcher setup */ }
	}

	dispose(): void {
		this.extensionCtx = null;
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
		if (this.pendingCheck) { clearInterval(this.pendingCheck); this.pendingCheck = null; }
		this.inboxWatcher?.close();
		this.inboxWatcher = null;
		this.notifiedCount = 0;
	}
}
