/** Boost settings: model ID and max yields stored in standard pi settings. */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const BOOST_MODEL_ID_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

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

/** Get the max yields before reset is required. */
export async function resolveMaxYields(
	_cwd: string,
): Promise<number> {
	const settings = await readSettings();
	const boost = settings.boost;
	if (typeof boost !== "object" || boost === null) return 3;
	const maxYields = (boost as Record<string, unknown>).maxYields;
	if (typeof maxYields !== "number" || !Number.isInteger(maxYields)) {
		return 3;
	}
	return Math.max(1, Math.min(10, maxYields));
}