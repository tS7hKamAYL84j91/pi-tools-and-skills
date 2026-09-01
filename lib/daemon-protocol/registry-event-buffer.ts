/**
 * M6 client overlap rules (design doc section 7, formal review F7, ADR-053),
 * as a pure reusable piece shared by the daemon implementation and the
 * pi-panopticon daemon-client: buffer events until the snapshot is applied,
 * drop events with seq <= the snapshot's seq, apply thereafter in order, and
 * resync (fresh snapshot) only on a true gap.
 */
import type { RegistryEvent, RegistrySnapshot } from "./registry-types.js";

/** Pre-snapshot buffering cap; overflow demands resync (DoS bound). */
const CLIENT_BUFFER_CAP = 1_024;

export class RegistryEventBuffer {
	private snapshotSeq?: number;
	private expectedSeq?: number;
	private readonly buffered: RegistryEvent[] = [];
	private readonly appliedEvents: RegistryEvent[] = [];
	private resyncNeeded = false;

	/**
	 * @param onApply invoked for every event as it is applied (including
	 * buffered ones drained after the snapshot) — the consumer's delta hook.
	 */
	constructor(private readonly onApply?: (event: RegistryEvent) => void) {}

	/** Events received before the snapshot: buffered, then reconciled on apply. */
	applyEvent(
		event: RegistryEvent,
	): "applied" | "buffered" | "dropped" | "resync" {
		if (this.snapshotSeq === undefined) {
			if (this.buffered.length >= CLIENT_BUFFER_CAP) {
				// Unbounded pre-snapshot buffering would be a DoS; overflow demands resync.
				this.resyncNeeded = true;
				return "resync";
			}
			this.buffered.push(event);
			return "buffered";
		}
		if (event.seq <= this.snapshotSeq) return "dropped";
		// SAFETY: snapshotSeq was set in applySnapshot, which also assigned
		// expectedSeq; both move together and are never cleared.
		const expectedSeq = this.expectedSeq as number;
		if (event.seq === expectedSeq) {
			this.appliedEvents.push(event);
			this.expectedSeq = event.seq + 1;
			this.onApply?.(event);
			this.drainBuffered();
			return "applied";
		}
		if (event.seq > expectedSeq) {
			// True gap (seq > last applied + 1): resync with a fresh snapshot.
			this.resyncNeeded = true;
			return "resync";
		}
		return "dropped"; // duplicate or already-applied event
	}

	/** Apply the snapshot: contained events are dropped, later ones applied in order. */
	applySnapshot(snapshot: RegistrySnapshot): {
		dropped: number;
		applied: number;
	} {
		this.snapshotSeq = snapshot.seq;
		this.expectedSeq = snapshot.seq + 1;
		this.resyncNeeded = false;
		let dropped = 0;
		const pending = [...this.buffered];
		this.buffered.length = 0;
		for (const event of pending) {
			if (event.seq <= snapshot.seq) {
				dropped++;
				continue;
			}
			if (event.seq === this.expectedSeq) {
				this.appliedEvents.push(event);
				this.expectedSeq = event.seq + 1;
				this.onApply?.(event);
				continue;
			}
			// A buffered event beyond the next expected seq is a gap: resync.
			this.resyncNeeded = true;
		}
		return { dropped, applied: this.appliedEvents.length };
	}

	get resyncRequired(): boolean {
		return this.resyncNeeded;
	}

	get applied(): readonly RegistryEvent[] {
		return this.appliedEvents;
	}

	private drainBuffered(): void {
		// SAFETY: drainBuffered only runs after applySnapshot assigned expectedSeq;
		// applyEvent calls it on the applied path, where expectedSeq is a number.
		const expectedSeq = this.expectedSeq as number;
		for (let index = 0; index < this.buffered.length; ) {
			const event = this.buffered[index] as RegistryEvent;
			if (event.seq === expectedSeq) {
				this.buffered.splice(index, 1);
				this.onApply?.(event);
			} else if (event.seq < expectedSeq) {
				// Stale buffered event, already contained: drop.
				this.buffered.splice(index, 1);
			} else {
				index++;
			}
		}
	}
}
