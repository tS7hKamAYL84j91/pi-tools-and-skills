/** Boost settings: read/validate and serialized-write the `boost` block of pi settings. */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";

/** Boost model ids look like provider/id (ADR-056: registry shapes, no provider literals). */
const BOOST_MODEL_ID_PATTERN = /^[\w.-]+\/[\w.:-]+$/;

/** ADR-045 §1 hard maximum: at most 3 human yields per lease. */
const HARD_MAX_YIELDS = 3;

function piSettingsPath(): string {
	return join(homedir(), ".pi", "agent", "settings.json");
}

async function readSettings(): Promise<Record<string, unknown>> {
	try {
		const raw = await readFile(piSettingsPath(), "utf8");
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/** Get the configured boost model ID, or undefined for auto-pick. */
export async function resolveBoostModel(
	_cwd: string,
): Promise<string | undefined> {
	const settings = await readSettings();
	const boost = settings.boost;
	if (typeof boost !== "object" || boost === null) return undefined;
	const model = (boost as Record<string, unknown>).model;
	if (typeof model !== "string" || !BOOST_MODEL_ID_PATTERN.test(model)) {
		return undefined;
	}
	return model;
}

/** Get the max yields before reset is required (hard cap 3, ADR-057). */
export async function resolveMaxYields(_cwd: string): Promise<number> {
	const settings = await readSettings();
	const boost = settings.boost;
	if (typeof boost !== "object" || boost === null) return 3;
	const maxYields = (boost as Record<string, unknown>).maxYields;
	if (typeof maxYields !== "number" || !Number.isInteger(maxYields)) {
		return 3;
	}
	return Math.max(1, Math.min(HARD_MAX_YIELDS, maxYields));
}

function boostBlock(settings: Record<string, unknown>): Record<string, unknown> {
	return typeof settings.boost === "object" && settings.boost !== null
		? (settings.boost as Record<string, unknown>)
		: {};
}

async function saveBoostSetting(
	key: "model" | "maxYields",
	value: string | number,
): Promise<void> {
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(await readFile(piSettingsPath(), "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		// Fresh settings file.
	}
	const boost = boostBlock(settings);
	boost[key] = value;
	settings.boost = boost;
	await writeFileAtomic(
		piSettingsPath(),
		`${JSON.stringify(settings, null, 2)}\n`,
		{ mode: 0o600 },
	);
}

/**
 * Serialize settings writes: overlay callbacks fire-and-forget, so concurrent
 * read-modify-write cycles would clobber each other. A single promise chain
 * makes each save re-read the latest file state.
 */
let writeChain: Promise<void> = Promise.resolve();

export function queueSaveBoostSetting(
	key: "model" | "maxYields",
	value: string | number,
): Promise<void> {
	const run = writeChain
		.then(() => saveBoostSetting(key, value))
		.catch((error: unknown) => {
			console.error(`boost: failed to save setting ${key}: ${String(error)}`);
		});
	writeChain = run;
	return run;
}