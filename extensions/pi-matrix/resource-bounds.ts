/** Small bounded resource helpers for Matrix ingress work. */

interface ResourceWaiter {
	reservationBytes: number;
	signal: AbortSignal;
	resolve: (release: () => void) => void;
	reject: (reason: unknown) => void;
	onAbort: () => void;
}

/** Bounds concurrent downloads, reserved bytes, and pending admission requests. */
export class AttachmentDownloadResources {
	private activeDownloads = 0;
	private reservedBytes = 0;
	private readonly waiters: ResourceWaiter[] = [];

	constructor(
		private readonly maxConcurrentDownloads: number,
		private readonly maxReservedBytes: number,
		private readonly maxPendingDownloads: number,
	) {
		if (maxConcurrentDownloads <= 0 || maxReservedBytes <= 0 || maxPendingDownloads <= 0) {
			throw new Error("Matrix attachment resource bounds must be positive.");
		}
	}

	async run<T>(reservationBytes: number, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
		const release = await this.acquire(reservationBytes, signal);
		try {
			return await operation();
		} finally {
			release();
		}
	}

	private acquire(reservationBytes: number, signal: AbortSignal): Promise<() => void> {
		if (reservationBytes <= 0 || reservationBytes > this.maxReservedBytes) {
			return Promise.reject(new Error(
				`Matrix attachment reservation exceeds aggregate in-flight limit (${reservationBytes} > ${this.maxReservedBytes}).`,
			));
		}
		if (signal.aborted) return Promise.reject(abortReason(signal));

		if (this.canAdmit(reservationBytes) && this.waiters.length === 0) {
			return Promise.resolve(this.reserve(reservationBytes));
		}
		if (this.waiters.length >= this.maxPendingDownloads) {
			return Promise.reject(new Error("Matrix attachment download queue is full."));
		}

		return new Promise((resolve, reject) => {
			const waiter: ResourceWaiter = {
				reservationBytes,
				signal,
				resolve,
				reject,
				onAbort: () => {
					const index = this.waiters.indexOf(waiter);
					if (index >= 0) this.waiters.splice(index, 1);
					reject(abortReason(signal));
					this.dispatch();
				},
			};
			signal.addEventListener("abort", waiter.onAbort, { once: true });
			this.waiters.push(waiter);
			this.dispatch();
		});
	}

	private canAdmit(reservationBytes: number): boolean {
		return this.activeDownloads < this.maxConcurrentDownloads
			&& this.reservedBytes + reservationBytes <= this.maxReservedBytes;
	}

	private reserve(reservationBytes: number): () => void {
		this.activeDownloads += 1;
		this.reservedBytes += reservationBytes;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.activeDownloads -= 1;
			this.reservedBytes -= reservationBytes;
			this.dispatch();
		};
	}

	private dispatch(): void {
		while (this.waiters.length > 0) {
			const waiter = this.waiters[0];
			if (!waiter || !this.canAdmit(waiter.reservationBytes)) return;
			this.waiters.shift();
			waiter.signal.removeEventListener("abort", waiter.onAbort);
			if (waiter.signal.aborted) {
				waiter.reject(abortReason(waiter.signal));
				continue;
			}
			waiter.resolve(this.reserve(waiter.reservationBytes));
		}
	}
}

// AbortSignal.reason is caller-controlled; preserve its native reason type as the rejection reason.
type AbortReason = AbortSignal["reason"] | Error;

function abortReason(signal: AbortSignal): AbortReason {
	return signal.reason ?? new Error("Matrix attachment download aborted.");
}

/** Insertion-order bounded set; duplicate insertion does not refresh age. */
export class BoundedRecentSet {
	private readonly values = new Set<string>();

	constructor(private readonly maxSize: number) {
		if (maxSize <= 0) throw new Error("Recent Matrix event ID bound must be positive.");
	}

	has(value: string): boolean {
		return this.values.has(value);
	}

	add(value: string): void {
		if (this.values.has(value)) return;
		if (this.values.size >= this.maxSize) {
			const oldest = this.values.values().next().value;
			if (oldest !== undefined) this.values.delete(oldest);
		}
		this.values.add(value);
	}
}

/** Default bound on queued-but-not-yet-active callback tasks (absorbs sync-turn bursts). */
const DEFAULT_MAX_PENDING_TASKS = 256;

/**
 * Runs a bounded number of detached callback tasks and contains their failures.
 *
 * The Matrix SDK fires event callbacks synchronously within a single sync turn,
 * so a run bound alone would drop every event past `maxActive` before any of
 * them had a chance to complete. Instead of dropping, accepted work beyond the
 * active bound is queued FIFO and dispatched as slots free up; dropping only
 * happens when the pending queue itself overflows.
 */
export class BoundedTaskSet {
	private readonly active = new Set<Promise<void>>();
	private readonly pending: Array<{
		operation: () => void | Promise<void>;
		onError: (error: unknown) => void;
	}> = [];
	private accepting = true;

	constructor(
		private readonly maxActive: number,
		private readonly maxPending: number = DEFAULT_MAX_PENDING_TASKS,
	) {
		if (maxActive <= 0) throw new Error("Matrix callback task bound must be positive.");
		if (maxPending <= 0) throw new Error("Matrix callback pending bound must be positive.");
	}

	open(): void {
		this.accepting = true;
	}

	tryRun(operation: () => void | Promise<void>, onError: (error: unknown) => void): boolean {
		if (!this.accepting) return false;
		if (this.active.size < this.maxActive) {
			this.start(operation, onError);
			return true;
		}
		if (this.pending.length >= this.maxPending) return false;
		this.pending.push({ operation, onError });
		return true;
	}

	private start(operation: () => void | Promise<void>, onError: (error: unknown) => void): void {
		const task = Promise.resolve()
			.then(operation)
			.catch(onError)
			.finally(() => {
				this.active.delete(task);
				this.dispatchQueued();
			});
		this.active.add(task);
	}

	private dispatchQueued(): void {
		while (this.active.size < this.maxActive && this.pending.length > 0) {
			const next = this.pending.shift();
			if (!next) return;
			this.start(next.operation, next.onError);
		}
	}

	async closeAndDrain(): Promise<void> {
		this.accepting = false;
		// Accepted events still run to completion; only events past close are refused.
		while (this.pending.length > 0 || this.active.size > 0) {
			this.dispatchQueued();
			if (this.active.size === 0) break;
			await Promise.allSettled([...this.active]);
		}
	}
}
