/** Process-wide keyed serialization for daemon control transactions. */

export class ProcessWideKeyedMutex {
	private static readonly tails = new Map<string, Promise<void>>();

	async runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
		const previous = ProcessWideKeyedMutex.tails.get(key) ?? Promise.resolve();
		let release = (): void => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(async () => gate);
		ProcessWideKeyedMutex.tails.set(key, tail);
		await previous;
		try {
			return await operation();
		} finally {
			release();
			if (ProcessWideKeyedMutex.tails.get(key) === tail) {
				ProcessWideKeyedMutex.tails.delete(key);
			}
		}
	}
}
