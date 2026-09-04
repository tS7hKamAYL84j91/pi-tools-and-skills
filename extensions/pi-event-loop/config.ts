/** Loading and strict validation of the .pi/event-loop.json configuration (SPEC §6, §18). */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	checkUnknownKeys,
	isNonEmptyString,
	isRecord,
} from "./config-guards.js";
import { DEFAULT_LIMITS, validateLimits } from "./config-limits.js";
import { validateProfile } from "./config-profile.js";
import type { EventLoopConfig, LimitsConfig, ProfileConfig } from "./types.js";

export const CONFIG_RELATIVE_PATH = ".pi/event-loop.json";

const TOP_LEVEL_KEYS = [
	"version",
	"activeProfile",
	"profiles",
	"limits",
] as const;

export interface EventLoopConfigResult {
	readonly ok: boolean;
	/** Set when no configuration file exists; the extension stays inert. */
	readonly missing?: boolean;
	readonly config?: EventLoopConfig;
	readonly fingerprint?: string;
	readonly errors: readonly string[];
}

/** A parsed configuration document whose fields are still unknown pending validation. */
interface RawConfig {
	readonly [key: string]: unknown;
}

interface StrictParseResult {
	readonly ok: boolean;
	readonly document?: RawConfig;
	readonly error?: string;
}

/**
 * Detect the first duplicate key within a single JSON object literal by scanning the raw text.
 * JSON.parse's reviver cannot see duplicates because later keys overwrite earlier ones before
 * the post-parse walk, so the scan must run on the source text.
 */
function findDuplicateJsonKey(text: string): string | undefined {
	interface ContainerFrame {
		readonly isObject: boolean;
		readonly keys: Set<string>;
		expectingKey: boolean;
	}
	const frames: ContainerFrame[] = [];
	let inString = false;
	let escapePending = false;
	let unicodePending = 0;
	let unicodeValue = 0;
	let buffer = "";
	let collectingKey = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index] ?? "";
		if (inString) {
			if (escapePending) {
				escapePending = false;
				if (char === "u") {
					unicodePending = 4;
					unicodeValue = 0;
				} else {
					buffer += DECODED_ESCAPES.get(char) ?? char;
				}
				continue;
			}
			if (unicodePending > 0) {
				const digit = Number.parseInt(char, 16);
				if (Number.isNaN(digit)) {
					// Malformed escape; JSON.parse rejects the document later.
					unicodePending = 0;
				} else {
					unicodeValue = unicodeValue * 16 + digit;
					unicodePending--;
					if (unicodePending === 0) {
						buffer += String.fromCharCode(unicodeValue);
					}
				}
				continue;
			}
			if (char === "\\") {
				escapePending = true;
				continue;
			}
			if (char === '"') {
				inString = false;
				if (collectingKey) {
					collectingKey = false;
					const top = frames.at(-1);
					if (top !== undefined && top.isObject) {
						if (top.keys.has(buffer)) {
							return buffer;
						}
						top.keys.add(buffer);
					}
				}
				continue;
			}
			buffer += char;
			continue;
		}
		const top = frames.at(-1);
		if (char === '"') {
			inString = true;
			buffer = "";
			collectingKey = false;
			if (top !== undefined && top.isObject && top.expectingKey) {
				collectingKey = true;
				top.expectingKey = false;
			}
			continue;
		}
		if (char === "{") {
			frames.push({
				isObject: true,
				keys: new Set<string>(),
				expectingKey: true,
			});
			continue;
		}
		if (char === "[") {
			frames.push({
				isObject: false,
				keys: new Set<string>(),
				expectingKey: false,
			});
			continue;
		}
		if (char === "}" || char === "]") {
			frames.pop();
			continue;
		}
		if (char === "," && top !== undefined && top.isObject) {
			top.expectingKey = true;
		}
	}
	return undefined;
}

const DECODED_ESCAPES: ReadonlyMap<string, string> = new Map([
	['"', '"'],
	["\\", "\\"],
	["/", "/"],
	["b", "\b"],
	["f", "\f"],
	["n", "\n"],
	["r", "\r"],
	["t", "\t"],
]);

/** Parse JSON, rejecting duplicate keys and non-object documents at the boundary. */
function parseJsonStrict(text: string): StrictParseResult {
	const duplicateKey = findDuplicateJsonKey(text);
	if (duplicateKey !== undefined) {
		return { ok: false, error: `duplicate JSON key "${duplicateKey}"` };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
	if (!isRecord(parsed)) {
		return { ok: false, error: "must be a JSON object" };
	}
	return { ok: true, document: parsed };
}

/** Parse and validate configuration text without touching the filesystem. */
export function parseEventLoopConfig(text: string): EventLoopConfigResult {
	const parsed = parseJsonStrict(text);
	if (!parsed.ok || parsed.document === undefined) {
		return {
			ok: false,
			errors: [`configuration: ${parsed.error ?? "invalid configuration"}`],
		};
	}
	const errors: string[] = [];
	const config = validateEventLoopConfig(parsed.document, errors);
	if (config === undefined || errors.length > 0) {
		return { ok: false, errors };
	}
	return {
		ok: true,
		config,
		fingerprint: createHash("sha256").update(text, "utf8").digest("hex"),
		errors,
	};
}

/** Load and validate `.pi/event-loop.json` for a session working directory. */
export async function loadEventLoopConfig(
	cwd: string,
): Promise<EventLoopConfigResult> {
	let text: string;
	try {
		text = await readFile(join(cwd, CONFIG_RELATIVE_PATH), "utf8");
	} catch {
		return { ok: false, missing: true, errors: [] };
	}
	return parseEventLoopConfig(text);
}

function validateEventLoopConfig(
	raw: unknown,
	errors: string[],
): EventLoopConfig | undefined {
	if (!isRecord(raw)) {
		errors.push("configuration: must be a JSON object");
		return undefined;
	}
	let valid = checkUnknownKeys(raw, TOP_LEVEL_KEYS, "configuration", errors);

	const version = raw["version"];
	if (version !== 1) {
		errors.push('configuration: "version" must be 1');
		valid = false;
	}

	const activeProfile = raw["activeProfile"];
	const hasActiveProfile = isNonEmptyString(activeProfile);
	if (!hasActiveProfile) {
		errors.push('configuration: "activeProfile" must be a non-empty string');
		valid = false;
	}

	const profilesRaw = raw["profiles"];
	if (!isRecord(profilesRaw)) {
		errors.push('configuration: "profiles" must be an object');
		return undefined;
	}
	if (Object.keys(profilesRaw).length === 0) {
		errors.push('configuration: "profiles" must contain at least one profile');
		valid = false;
	}

	const profiles: Record<string, ProfileConfig> = {};
	for (const [name, profileRaw] of Object.entries(profilesRaw)) {
		const profile = validateProfile(name, profileRaw, errors);
		if (profile === undefined) {
			valid = false;
			continue;
		}
		profiles[name] = profile;
	}

	const rawLimits = raw["limits"];
	let limits: LimitsConfig = { ...DEFAULT_LIMITS };
	if (rawLimits !== undefined) {
		const validated = validateLimits(rawLimits, errors);
		if (validated === undefined) {
			valid = false;
		} else {
			limits = validated;
		}
	}

	if (!valid || !hasActiveProfile) {
		return undefined;
	}
	const activeConfig = profiles[activeProfile];
	if (activeConfig === undefined) {
		errors.push(
			`configuration: "activeProfile" "${activeProfile}" is not defined in "profiles"`,
		);
		return undefined;
	}
	return { version: 1, activeProfile: activeProfile, profiles, limits };
}
