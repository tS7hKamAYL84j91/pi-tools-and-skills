/** Transient, garbage-collectable per-owner run subscriptions. */

interface RunSubscriptions {
	readonly byRun: Map<string, Set<() => void>>;
}

const SUBSCRIPTIONS = new WeakMap<object, RunSubscriptions>();

function subscriptionsFor(owner: object): RunSubscriptions {
	const existing = SUBSCRIPTIONS.get(owner);
	if (existing) return existing;
	const created: RunSubscriptions = { byRun: new Map() };
	SUBSCRIPTIONS.set(owner, created);
	return created;
}

export function notifyRunSubscribers(owner: object, runId: string): void {
	for (const listener of [...(SUBSCRIPTIONS.get(owner)?.byRun.get(runId) ?? [])]) {
		try {
			listener();
		} catch {
			// A UI or observer failure must not interrupt state transitions or peers.
		}
	}
}

export function subscribeToRun(owner: object, runId: string, listener: () => void): () => void {
	const subscriptions = subscriptionsFor(owner);
	const listeners = subscriptions.byRun.get(runId) ?? new Set<() => void>();
	const subscription = (): void => listener();
	listeners.add(subscription);
	subscriptions.byRun.set(runId, listeners);
	let subscribed = true;
	return () => {
		if (!subscribed) return;
		subscribed = false;
		listeners.delete(subscription);
		if (listeners.size === 0) subscriptions.byRun.delete(runId);
	};
}
