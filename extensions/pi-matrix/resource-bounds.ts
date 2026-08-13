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

function abortReason(signal: AbortSignal): unknown {
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

/** Runs a fixed number of detached callback tasks and contains their failures. */
export class BoundedTaskSet {
	private readonly active = new Set<Promise<void>>();
	private accepting = true;

	constructor(private readonly maxActive: number) {
		if (maxActive <= 0) throw new Error("Matrix callback task bound must be positive.");
	}

	open(): void {
		this.accepting = true;
	}

	tryRun(operation: () => void | Promise<void>, onError: (error: unknown) => void): boolean {
		if (!this.accepting || this.active.size >= this.maxActive) return false;
		const task = Promise.resolve()
			.then(operation)
			.catch(onError)
			.finally(() => this.active.delete(task));
		this.active.add(task);
		return true;
	}

	async closeAndDrain(): Promise<void> {
		this.accepting = false;
		await Promise.allSettled([...this.active]);
	}
}
