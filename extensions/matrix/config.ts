/**
 * Matrix extension — config loader.
 *
 * Reads the `matrix` block from a project's .pi/settings.json and resolves
 * env-var-backed secrets at runtime. The literal access token NEVER comes
 * from settings.json — only its env var name does.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MatrixConfig } from "./types.js";

// ── Defaults ─────────────────────────────────────���──────────────

const DEFAULT_CRYPTO_STORE = join(homedir(), ".pi", "agent", "matrix-crypto");
const DEFAULT_DEVICE_NAME = "CoAS Chief of Staff (extension)";
const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

// ── Raw config shape from settings.json ──────────────────────���──

interface RawMatrixSettings {
	homeserver?: unknown;
	userId?: unknown;
	roomId?: unknown;
	accessTokenEnv?: unknown;
	encryption?: unknown;
	cryptoStorePath?: unknown;
	deviceDisplayName?: unknown;
	channelLabel?: unknown;
	trustedSenders?: unknown;
}

// ── Loading ───────────────────────────────��─────────────────────

function readMatrixSettings(path: string): RawMatrixSettings | null {
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as { matrix?: RawMatrixSettings };
		return parsed.matrix ?? null;
	} catch {
		return null;
	}
}

/**
 * Resolve the matrix config from settings + environment.
 * Returns null if no matrix block is configured (valid "disabled" state).
 * Throws on validation errors.
 */
export function loadMatrixConfig(projectSettingsPath?: string): MatrixConfig | null {
	const projectSettings = projectSettingsPath ? readMatrixSettings(projectSettingsPath) : null;
	const globalSettings = readMatrixSettings(PI_SETTINGS_PATH);
	const raw = projectSettings ?? globalSettings;
	if (!raw) return null;

	const homeserver = requireString(raw.homeserver, "matrix.homeserver");
	const userId = requireString(raw.userId, "matrix.userId");
	const roomId = requireString(raw.roomId, "matrix.roomId");
	const accessTokenEnv = requireString(raw.accessTokenEnv, "matrix.accessTokenEnv");

	if (!userId.startsWith("@") || !userId.includes(":")) {
		throw new Error(`matrix.userId must be a Matrix MXID (e.g. "@coas-bot:matrix.org"); got "${userId}"`);
	}
	if (!roomId.startsWith("!") || !roomId.includes(":")) {
		throw new Error(`matrix.roomId must be a Matrix room ID (e.g. "!abc:matrix.org"); got "${roomId}"`);
	}

	const accessToken = process.env[accessTokenEnv];
	if (!accessToken) {
		throw new Error(
			`matrix: env var "${accessTokenEnv}" is not set. ` +
			`Add it to your shell rc or secrets manager.`,
		);
	}

	const encryption = raw.encryption === true; // default false
	const cryptoStorePath = expandHome(optionalString(raw.cryptoStorePath) ?? DEFAULT_CRYPTO_STORE);
	const deviceDisplayName = optionalString(raw.deviceDisplayName) ?? DEFAULT_DEVICE_NAME;
	const channelLabel = optionalString(raw.channelLabel) ?? "matrix";
	const trustedSenders = Array.isArray(raw.trustedSenders)
		? (raw.trustedSenders as unknown[]).filter((s): s is string => typeof s === "string")
		: [];

	return {
		homeserver,
		userId,
		roomId,
		accessToken,
		encryption,
		cryptoStorePath,
		deviceDisplayName,
		channelLabel,
		trustedSenders,
	};
}

// ── Helpers ──────────────────���────────────────────────��─────────

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`matrix config: ${fieldName} is required and must be a non-empty string`);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	return value;
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (path === "~") return homedir();
	return path;
}
