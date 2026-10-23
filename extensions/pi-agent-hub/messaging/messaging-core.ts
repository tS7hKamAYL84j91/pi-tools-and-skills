/**
 * Messaging core logic for pi-agent-hub.
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

/** Debounce before announcing newly arrived messages. */
const POKE_DEBOUNCE_MS = 2_000;
/**
 * Re-announce window for a notification that never reached a turn.
 *
 * `pi.sendUserMessage` is fire-and-forget and can fail (for example during
 * compaction). A retry is only justified while no turn boundary has happened
 * since the poke: once a turn has run, the notification was delivered and
 * re-queuing the same reminder would leave duplicate "N new messages" turns
 * behind for mail the first `message_read` already consumed.
 */
const POKE_RETRY_MS = 30_000;
/** Hard cap so a broken injection path cannot queue reminders forever. */
const MAX_POKE_RETRIES = 3;

export class MessagingCore {
	private extensionCtx: ExtensionContext | null = null;
	private pokeTimeout: ReturnType<typeof setTimeout> | null = null;
	private inboxWatcher: FSWatcher | null = null;
	private pendingCheck: ReturnType<typeof setInterval> | null = null;
	private notifiedCount = 0;
	private lastPokeAt = 0;
	private turnSincePoke = false;
	private pokeRetries = 0;

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
		if (!this.extensionCtx) return;
		if (this.totalPending() === 0) {
			this.resetPokeState();
			return;
		}
		if (this.pokeTimeout) return;
		const delay = this.nextPokeDelay();
		if (delay === null) return;
		this.pokeTimeout = setTimeout(() => {
			this.pokeTimeout = null;
			if (this.totalPending() === 0) {
				this.resetPokeState();
				return;
			}
			this.pokeNow();
		}, delay);
		this.pokeTimeout.unref();
	}

	/**
	 * A model turn completed (turn_end / agent_end). A queued notification is
	 * pulled at a turn boundary, so after one the reminder must not be re-queued
	 * on a timer; only genuinely new mail justifies another notification.
	 */
	noteTurnBoundary(): void {
		if (this.notifiedCount > 0) this.turnSincePoke = true;
	}

	private resetPokeState(): void {
		this.notifiedCount = 0;
		this.lastPokeAt = 0;
		this.turnSincePoke = false;
		this.pokeRetries = 0;
	}

	/**
	 * Delay until the next notification attempt.
	 *
	 * A notification that is already outstanding (notified but not consumed) is
	 * retried only after POKE_RETRY_MS, so a busy agent gets one queued poke
	 * rather than one per arriving message.
	 */
	private nextPokeDelay(): number | null {
		if (this.notifiedCount === 0) return POKE_DEBOUNCE_MS;
		if (this.turnSincePoke) {
			// The outstanding reminder already had its turn: only newer mail is
			// worth another notification.
			return this.totalPending() > this.notifiedCount ? POKE_DEBOUNCE_MS : null;
		}
		if (this.pokeRetries >= MAX_POKE_RETRIES) return null;
		const elapsed = Date.now() - this.lastPokeAt;
		return Math.max(POKE_DEBOUNCE_MS, POKE_RETRY_MS - elapsed);
	}

	pokeNow(force = false): void {
		if (!this.extensionCtx) return;
		const count = this.totalPending();
		if (count === 0) {
			this.resetPokeState();
			return;
		}
		// One outstanding notification is enough. It is either consumed by
		// message_read, or retried while it never reached a turn (failed
		// injection), or superseded once a turn ran and newer mail arrived.
		if (!force && this.notifiedCount > 0) {
			const elapsed = Date.now() - this.lastPokeAt;
			if (this.turnSincePoke) {
				if (count <= this.notifiedCount) {
					this.schedulePoke();
					return;
				}
			} else if (elapsed < POKE_RETRY_MS || this.pokeRetries >= MAX_POKE_RETRIES) {
				this.schedulePoke();
				return;
			}
		}
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
		const previousCount = this.notifiedCount;
		const previousPokeAt = this.lastPokeAt;
		const previousRetries = this.pokeRetries;
		const previousTurn = this.turnSincePoke;
		this.pokeRetries = previousCount > 0 ? previousRetries + 1 : 0;
		this.notifiedCount = count;
		this.lastPokeAt = Date.now();
		this.turnSincePoke = false;
		try {
			// Idle: sendUserMessage starts a turn. Busy: "followUp" queues the
			// notification for the next turn boundary instead of interrupting or,
			// worse, waiting for the agent to become idle before it is even queued.
			this.pi.sendUserMessage(
				`${count} new message${count > 1 ? "s" : ""}. Use message_read to see ${count > 1 ? "them" : "it"}.`,
				{ deliverAs: "followUp" },
			);
		} catch {
			// Keep mail unread and retry a transient injection failure.
			this.notifiedCount = previousCount;
			this.lastPokeAt = previousPokeAt;
			this.pokeRetries = previousRetries;
			this.turnSincePoke = previousTurn;
			this.schedulePoke();
		}
	}

	drainAllChannels(): ChannelMessage[] {
		this.resetPokeState();
		// The outstanding notification has been consumed; drop any retry timer so
		// the next arrival triggers a fresh debounced poke instead of inheriting
		// the previous retry window.
		if (this.pokeTimeout) { clearTimeout(this.pokeTimeout); this.pokeTimeout = null; }
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
			if (this.totalPending() === 0) this.resetPokeState();
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
		this.resetPokeState();
	}
}
