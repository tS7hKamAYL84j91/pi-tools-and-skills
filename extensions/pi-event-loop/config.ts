/** Loading and strict validation of the .pi/event-loop.json configuration (SPEC §6, §18). */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	checkUnknownKeys,
	findDuplicateJsonKey,
	isNonEmptyString,
	isRecord,
} from "./config-guards.js";
import { DEFAULT_LIMITS, validateLimits } from "./config-limits.js";
import { validateProfile } from "./config-profile.js";
import type { EventLoopConfig, LimitsConfig, ProfileConfig } from "./types.js";

const DEFAULT_CONFIG_DIR = ".pi";
const CONFIG_FILENAME = "event-loop.json";
export const CONFIG_RELATIVE_PATH = `${DEFAULT_CONFIG_DIR}/${CONFIG_FILENAME}`;

export interface LoadConfigOptions {
	/** If false, project-local configuration will not be loaded. */
	readonly trusted?: boolean;
	/** Config directory override (defaults to DEFAULT_CONFIG_DIR, ".pi"). */
	readonly configDir?: string;
}

function resolveConfigRelativePath(configDir = DEFAULT_CONFIG_DIR): string {
	return join(configDir, CONFIG_FILENAME);
}

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
	options?: LoadConfigOptions,
): Promise<EventLoopConfigResult> {
	if (options?.trusted === false) {
		return {
			ok: false,
			missing: false,
			errors: ["project is untrusted: project configuration not loaded"],
		};
	}
	const relPath = resolveConfigRelativePath(options?.configDir);
	let text: string;
	try {
		text = await readFile(join(cwd, relPath), "utf8");
	} catch (error) {
		const isEnoent =
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT";
		if (isEnoent) {
			return { ok: false, missing: true, errors: [] };
		}
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			missing: false,
			errors: [`I/O error loading configuration: ${message}`],
		};
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
