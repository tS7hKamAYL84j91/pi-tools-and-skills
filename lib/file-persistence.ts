/** Shared local file persistence helpers for state-owning code. */
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type FileData = string | Buffer | Uint8Array;

export interface WriteFileAtomicOptions {
	readonly encoding?: BufferEncoding;
	readonly mode?: number;
}

export interface AppendLogLineOptions {
	readonly encoding?: BufferEncoding;
	readonly mode?: number;
}

export interface UpdateJsonFileOptions<T> extends WriteFileAtomicOptions {
	readonly defaultValue: T;
}

/**
 * Write a complete file via same-directory temp file and rename.
 *
 * This gives readers either the old complete file or the new complete file;
 * callers still need a higher-level lock when concurrent read/modify/write
 * updates must be serialized.
 */
export async function writeFileAtomic(
	path: string,
	data: FileData,
	options: WriteFileAtomicOptions = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = join(dirname(path), `.${process.pid}.${randomUUID()}.tmp`);
	try {
		const file = await open(tmpPath, "wx", options.mode ?? 0o600);
		try {
			if (typeof data === "string") {
				await file.writeFile(data, options.encoding ?? "utf8");
			} else {
				await file.writeFile(data);
			}
		} finally {
			await file.close();
		}
		await rename(tmpPath, path);
	} catch (error) {
		await rm(tmpPath, { force: true }).catch(() => {});
		throw error;
	}
}

/** Append one complete log line, adding a trailing newline if needed. */
export async function appendLogLine(
	path: string,
	line: string,
	options: AppendLogLineOptions = {},
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const file = await open(path, "a", options.mode ?? 0o600);
	try {
		await file.writeFile(
			line.endsWith("\n") ? line : `${line}\n`,
			options.encoding ?? "utf8",
		);
	} finally {
		await file.close();
	}
}

/** Read, update, and atomically rewrite a JSON file. */
export async function updateJsonFile<T>(
	path: string,
	update: (current: T) => T | Promise<T>,
	options: UpdateJsonFileOptions<T>,
): Promise<T> {
	let current = options.defaultValue;
	try {
		current = JSON.parse(await readFile(path, options.encoding ?? "utf8")) as T;
	} catch (error) {
		if (!isMissingFileError(error)) {
			throw error;
		}
	}
	const next = await update(current);
	await writeFileAtomic(path, `${JSON.stringify(next, null, 2)}\n`, options);
	return next;
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
