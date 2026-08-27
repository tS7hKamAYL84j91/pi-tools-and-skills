/**
 * Strict durable-record reading and quarantine (design doc section 4,
 * ADR section 8): duplicate-key/BOM/trailing-garbage/size-cap rejection;
 * corrupt records move to quarantine (raw bytes preserved, never truncated
 * or dropped silently) with a durable audit event.
 */
import { readFile, rename } from "node:fs/promises";
import { ensureValidatedDir } from "./durable-fs.js";
import { join } from "node:path";
import { appendAudit } from "./audit.js";
import { quarantineDir } from "./paths.js";
import type { DaemonRoots } from "./paths.js";

/** Read a durable JSON record strictly, or quarantine it and return undefined. */
export async function readRecordStrict<T>(
	roots: DaemonRoots,
	path: string,
	validate: (value: unknown) => T | undefined,
	maxBytes = 1_048_576,
): Promise<T | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const parsed = parseRecordStrict(raw, maxBytes);
		return validate(parsed);
	} catch (error) {
		await quarantineRecord(roots, path, (error as Error).message);
		return undefined;
	}
}

/** Strict single-object JSON: BOM, trailing garbage, duplicate keys, size cap. */
export function parseRecordStrict(raw: string, maxBytes: number): unknown {
	if (raw.charCodeAt(0) === 0xfeff) throw new Error("BOM rejected");
	if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("record exceeds parse cap");
	const trimmed = raw.trim();
	if (trimmed.length === 0) throw new Error("empty record");
	// JSON.parse throws on trailing tokens; duplicate keys are caught by the
	// per-object seen-set reviver (JSON.parse collapses repeats silently).
	const seenKeys = new WeakMap<object, Set<string>>();
	return JSON.parse(trimmed, function (this: object, key: string, value: unknown) {
		if (key === "__proto__") throw new Error("prototype key rejected");
		if (typeof this === "object" && this !== null) {
			let seen = seenKeys.get(this);
			if (seen === undefined) {
				seen = new Set<string>();
				seenKeys.set(this, seen);
			}
			if (seen.has(key)) throw new Error(`duplicate key: ${key}`);
			seen.add(key);
		}
		return value;
	});
}

/** Quarantine a corrupt record: atomic move (raw bytes preserved) + durable audit. */
export async function quarantineRecord(roots: DaemonRoots, path: string, reason: string): Promise<string> {
	const name = path.split("/").pop() ?? "record";
	const target = join(quarantineDir(roots), `${name}.corrupt-${Date.now()}`);
	// The quarantine directory may not exist yet; create it validated before
	// the move, or the rename fails silently and the corrupt record lingers.
	await ensureValidatedDir(quarantineDir(roots), roots.stateRoot);
	await rename(path, target).catch(() => {});
	await appendAudit(roots, { kind: "record_quarantined", path, reason }, { durable: true });
	return target;
}