/** Durable append-only event log with replay, snapshots, and compaction. */
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { withAdvisoryLock } from "./file-lock.js";

export interface EventLogCodec<T> {
	readonly encode: (event: T) => string;
	readonly decode: (line: string) => T;
}

export interface EventLogOptions<T> {
	readonly codec?: EventLogCodec<T>;
	readonly mode?: number;
}

export interface CompactionOptions {
	/** Preserve the replaced log at this path before installing the compacted log. */
	readonly backupPath?: string;
}

export interface CompactionResult {
	readonly eventsBefore: number;
	readonly eventsAfter: number;
	readonly backupPath?: string;
}

const JSON_CODEC: EventLogCodec<unknown> = {
	encode: (event) => JSON.stringify(event),
	decode: (line) => JSON.parse(line) as unknown,
};

/** Codec for legacy logs whose events are already complete text lines. */
export const textEventLogCodec: EventLogCodec<string> = {
	encode: (event) => event,
	decode: (line) => line,
};

/** A small JSON-lines WAL. Every mutation is serialized by the log lock. */
export class EventLog<T> {
	private readonly codec: EventLogCodec<T>;
	private readonly mode: number;

	constructor(private readonly path: string, options: EventLogOptions<T> = {}) {
		this.codec = options.codec ?? (JSON_CODEC as EventLogCodec<T>);
		this.mode = options.mode ?? 0o600;
	}

	/** Run an operation while holding this log's lock. */
	async withLock<R>(fn: () => Promise<R>): Promise<R> {
		return withAdvisoryLock(this.path, fn);
	}

	/** Append one event or a batch as one durable write. */
	async append(event: T | readonly T[]): Promise<void> {
		// Array.isArray cannot preserve the generic element type through narrowing.
		const events: readonly T[] = Array.isArray(event) ? event as T[] : [event as T];
		if (events.length === 0) return;
		await this.withLock(async () => this.appendUnlocked(events));
	}

	/** Replay events in log order without materializing the complete log. */
	async *replay(): AsyncGenerator<T> {
		let raw: string;
		try {
			raw = await readFile(this.path, "utf8");
		} catch (error) {
			if (isMissingFileError(error)) return;
			throw error;
		}
		for (const line of raw.split("\n")) {
			if (line.trim()) yield this.codec.decode(line);
		}
	}

	/** Materialize replay, useful for reducers and tests. */
	async read(): Promise<T[]> {
		const events: T[] = [];
		for await (const event of this.replay()) events.push(event);
		return events;
	}

	/** Atomically write a snapshot while holding the WAL lock. */
	async snapshot<S>(snapshotPath: string, value: S, encode: (value: S) => string = (item) => JSON.stringify(item)): Promise<void> {
		await withAdvisoryLock(this.path, async () => writeDurably(snapshotPath, `${encode(value)}\n`, this.mode));
	}

	/** Replace the WAL with a compacted event sequence under the WAL lock. */
	async compact(events: readonly T[], options: CompactionOptions = {}): Promise<CompactionResult> {
		return withAdvisoryLock(this.path, async () => {
			let eventsBefore = 0;
			try {
				const raw = await readFile(this.path, "utf8");
				eventsBefore = raw.split("\n").filter((line) => line.trim()).length;
			} catch (error) {
				if (!isMissingFileError(error)) throw error;
			}
			if (options.backupPath) {
				try {
					const raw = await readFile(this.path);
					await writeDurably(options.backupPath, raw, this.mode);
				} catch (error) {
					if (!isMissingFileError(error)) throw error;
				}
			}
			await writeDurably(this.path, encodeLines(events, this.codec), this.mode);
			return { eventsBefore, eventsAfter: events.length, ...(options.backupPath ? { backupPath: options.backupPath } : {}) };
		});
	}

	/** Append while the caller already holds this log's lock. */
	async appendLocked(event: T | readonly T[]): Promise<void> {
		// Array.isArray cannot preserve the generic element type through narrowing.
		const events: readonly T[] = Array.isArray(event) ? event as T[] : [event as T];
		if (events.length > 0) await this.appendUnlocked(events);
	}

	private async appendUnlocked(events: readonly T[]): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true });
		const file = await open(this.path, "a", this.mode);
		try {
			await file.writeFile(encodeLines(events, this.codec), "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
	}
}

function encodeLines<T>(events: readonly T[], codec: EventLogCodec<T>): string {
	return `${events.map((event) => codec.encode(event).replace(/\r?\n/g, "")).join("\n")}\n`;
}

async function writeDurably(path: string, data: string | Uint8Array, mode: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
	try {
		const file = await open(temporaryPath, "wx", mode);
		try {
			await file.writeFile(data);
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	}
}

function isMissingFileError(error: unknown): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
