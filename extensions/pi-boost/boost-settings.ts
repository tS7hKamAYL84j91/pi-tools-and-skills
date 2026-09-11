/** Boost settings: read/validate and serialized-write the `boost` block of pi settings. */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";

/** Boost model ids look like provider/id (ADR-056: registry shapes, no provider literals). */
const BOOST_MODEL_ID_PATTERN = /^[\w.-]+\/\S+$/;

/** ADR-045 §1 hard maximum: at most 3 human yields per lease. */
const HARD_MAX_YIELDS = 3;

/**
 * Lease TTL: an idle expired lease renews on the next human /boost request.
 * This is not a model-switch timer: an in-flight boost restores on settle.
 */
export const BOOST_LEASE_TTL_MS = 600_000;

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

function boostBlock(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	return typeof settings.boost === "object" && settings.boost !== null
		? (settings.boost as Record<string, unknown>)
		: {};
}

/** Get the configured boost model ID, or undefined for auto-pick. */
export async function resolveBoostModel(): Promise<string | undefined> {
	const model = boostBlock(await readSettings()).model;
	return typeof model === "string" && BOOST_MODEL_ID_PATTERN.test(model)
		? model
		: undefined;
}

/** Get the max yields before reset is required (hard cap 3, ADR-057). */
export async function resolveMaxYields(): Promise<number> {
	const maxYields = boostBlock(await readSettings()).maxYields;
	return typeof maxYields === "number" && Number.isInteger(maxYields)
		? Math.max(1, Math.min(HARD_MAX_YIELDS, maxYields))
		: 3;
}

/** Lease length in minutes; invalid settings retain the 10-minute default. */
export async function resolveLeaseMinutes(): Promise<number> {
	const minutes = boostBlock(await readSettings()).leaseMinutes;
	return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 1 && minutes <= 60
		? minutes
		: BOOST_LEASE_TTL_MS / 60_000;
}

async function saveBoostSetting(
	key: "model" | "maxYields" | "leaseMinutes",
	value: string | number,
): Promise<void> {
	const settings = await readSettings();
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
	key: "model" | "maxYields" | "leaseMinutes",
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
