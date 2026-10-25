/**
 * Cockpit configuration contract.
 *
 * Strict JSON: unknown fields fail startup (fleet-mcp precedent). Paths are
 * explicit — the cockpit never discovers sessions or reads project state on
 * its own; "one explicitly configured session" is the whole model.
 * No credentials belong in this file.
 */
import { readFileSync } from "node:fs";

export interface CockpitConfig {
	/** Child command (default: `pi`). Tests point this at a fake RPC child. */
	command?: string;
	/** Verbatim child argument override (fake/test mode). Mutually exclusive with built args. */
	args?: string[];
	/** Working directory for the agent session. */
	cwd?: string;
	/** Optional provider filter. */
	provider?: string;
	/** Optional model id. */
	model?: string;
	/** Display name for the session. */
	name?: string;
	/** Dedicated session directory; without it the child runs `--no-session` so the PoC never writes into live fleet session stores. */
	sessionDir?: string;
	/** Public decisions file for read-only decision navigation (e.g. `docs/decisions.md`). */
	decisionsPath?: string;
}

const STRING_FIELDS = [
	"command",
	"cwd",
	"provider",
	"model",
	"name",
	"sessionDir",
	"decisionsPath",
] as const satisfies readonly (keyof CockpitConfig)[];

const KNOWN_FIELDS = new Set<string>([...STRING_FIELDS, "args"]);

// --- boundary decode: every runtime type check for untrusted JSON lives here ---

type JsonObject = Record<string, unknown>;

function decodeObject(value: unknown): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("cockpit config must be a JSON object");
	}
	return value as JsonObject;
}

function decodeNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`config field "${field}" must be a non-empty string`);
	}
	return value;
}

function decodeStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`config field "${field}" must be an array of strings`);
	}
	const entries: unknown[] = value;
	return entries.map((entry) => {
		if (typeof entry !== "string") {
			throw new Error(`config field "${field}" must be an array of strings`);
		}
		return entry;
	});
}

// --- domain model: no runtime checks below this line ---

export function parseCockpitConfig(value: unknown): CockpitConfig {
	const record = decodeObject(value);
	const unknown = Object.keys(record).filter((key) => !KNOWN_FIELDS.has(key));
	if (unknown.length > 0) {
		throw new Error(`unknown cockpit config fields: ${unknown.join(", ")}`);
	}

	const config: CockpitConfig = {};
	for (const field of STRING_FIELDS) {
		const raw = record[field];
		if (raw === undefined) continue;
		config[field] = decodeNonEmptyString(raw, field);
	}

	const rawArgs = record.args;
	if (rawArgs !== undefined) config.args = decodeStringArray(rawArgs, "args");

	const overridesModel = config.model !== undefined || config.provider !== undefined;
	if (config.args !== undefined && overridesModel) {
		throw new Error('"args" override is mutually exclusive with "provider"/"model"');
	}
	return config;
}

/** Strict loader: unknown fields and malformed content fail with a readable message. */
export function loadCockpitConfig(path: string): CockpitConfig {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read cockpit config ${path}: ${reason}`);
	}
	return parseCockpitConfig(parsed);
}

/** Pure child-argument builder: explicit isolation is the default, not an accident. */
export function buildChildArgs(config: CockpitConfig): string[] {
	if (config.args !== undefined) return [...config.args];
	const args = ["--mode", "rpc"];
	if (config.sessionDir === undefined) args.push("--no-session");
	if (config.name !== undefined) args.push("--name", config.name);
	if (config.provider !== undefined) args.push("--provider", config.provider);
	if (config.model !== undefined) args.push("--model", config.model);
	return args;
}
