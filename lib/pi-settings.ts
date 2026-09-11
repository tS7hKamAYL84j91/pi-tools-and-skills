/**
 * Pi settings reader — central helper for ~/.pi/agent/settings.json.
 *
 * Each extension's settings reader independently re-implemented the
 * same try/catch + JSON.parse + key-extract pattern. This module provides
 * the single helper; callers narrow/validate the unknown result.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { withAdvisoryLock } from "./file-lock.js";
import { writeFileAtomic } from "./file-persistence.js";

export const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

export type PiSettingsValue =
	| Record<string, unknown>
	| readonly unknown[]
	| string
	| number
	| boolean
	| null;

function isPiSettingsValue(value: unknown): value is PiSettingsValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return true;
	}
	return typeof value === "object";
}

/**
 * Read a top-level key from a pi settings JSON file.
 * Returns `undefined` if the file is missing, unreadable, malformed, or the key
 * is absent. Caller validates the shape of the returned value.
 */
export function readPiSettingsKey(
	key: string,
	path: string = PI_SETTINGS_PATH,
): PiSettingsValue | undefined {
	try {
		if (basename(path) !== "settings.json") return undefined;
		if (!existsSync(path)) return undefined;
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const value = parsed[key];
		return isPiSettingsValue(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Update a namespace block in a pi settings JSON file safely under an advisory lock.
 * Creates parent directory / file if absent, merges mutations safely, and writes atomically with 0o600 mode.
 */
export async function savePiSettingsBlock(
	namespace: string,
	mutateBlock: (block: Record<string, unknown>) => void,
	path: string = PI_SETTINGS_PATH,
): Promise<void> {
	await withAdvisoryLock(path, async () => {
		let existing: Record<string, unknown> = {};
		try {
			if (existsSync(path)) {
				const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					existing = parsed as Record<string, unknown>;
				}
			}
		} catch {
			// Start with fresh settings on malformed file
		}
		const block =
			existing[namespace] && typeof existing[namespace] === "object" && !Array.isArray(existing[namespace])
				? (existing[namespace] as Record<string, unknown>)
				: {};
		mutateBlock(block);
		existing[namespace] = block;
		await writeFileAtomic(
			path,
			`${JSON.stringify(existing, null, 2)}\n`,
			{ mode: 0o600 },
		);
	});
}
