/** Tracks scheduler work so shutdown can reject new work and drain in flight tasks. */
export class SchedulerWorkTracker {
	private acceptingWork = true;
	private readonly trackedWork = new Set<Promise<unknown>>();
	private stopPromise: Promise<void> | undefined;

	get accepting(): boolean {
		return this.acceptingWork;
	}

	/** Reopens tracking unless a prior stop is still draining. */
	start(): boolean {
		if (this.stopPromise) return false;
		this.acceptingWork = true;
		return true;
	}

	/** Tracks an operation until either fulfillment or rejection. */
	track<T>(operation: Promise<T>): Promise<T> {
		this.trackedWork.add(operation);
		void operation.then(
			() => this.trackedWork.delete(operation),
			() => this.trackedWork.delete(operation),
		);
		return operation;
	}

	/** Stops admission, drains tracked work, then performs scheduler cleanup once. */
	stop(cleanup: () => Promise<void>): Promise<void> {
		if (this.stopPromise) return this.stopPromise;
		this.acceptingWork = false;
		const stopping = this.drainAndCleanup(cleanup);
		this.stopPromise = stopping;
		void stopping.then(
			() => this.clearStop(stopping),
			() => this.clearStop(stopping),
		);
		return stopping;
	}

	private async drainAndCleanup(cleanup: () => Promise<void>): Promise<void> {
		await Promise.allSettled([...this.trackedWork]);
		await cleanup();
	}

	private clearStop(stopping: Promise<void>): void {
		if (this.stopPromise === stopping) this.stopPromise = undefined;
	}
}
