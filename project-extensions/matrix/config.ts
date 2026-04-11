/**
 * Matrix extension — config loader.
 *
 * Reads the `matrix` block from ~/.pi/agent/settings.json (or wherever pi
 * loads its settings from) and resolves env-var-backed secrets at runtime.
 *
 * The literal access token NEVER comes from settings.json — only its env
 * var name does. The token is read from process.env at load time and the
 * extension throws if it's missing.
 *
 * Validation happens once at session_start. Errors are reported via
 * ctx.ui.notify so the user sees the misconfiguration immediately.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MatrixConfig } from "./types.js";

// ── Defaults ────────────────────────────────────────────────────

const DEFAULT_CRYPTO_STORE = join(homedir(), ".pi", "agent", "matrix-crypto");
const DEFAULT_DEVICE_NAME = "CoAS Chief of Staff (extension)";
const PI_SETTINGS_PATH = join(homedir(), ".pi", "agent", "settings.json");

// ── Raw config shape from settings.json ─────────────────────────

interface RawMatrixSettings {
	homeserver?: unknown;
	userId?: unknown;
	roomId?: unknown;
	targetAgent?: unknown;
	accessTokenEnv?: unknown;
	encryption?: unknown;
	cryptoStorePath?: unknown;
	deviceDisplayName?: unknown;
	secureBackupEnv?: unknown;
}

// ── Loading ─────────────────────────────────────────────────────

/**
 * Load the matrix block from a settings.json file. Returns null if the
 * file doesn't exist or has no matrix section — that's a normal "extension
 * is configured but disabled" state, not an error.
 */
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
 *
 * Throws on validation errors so callers can surface them. Returns null
 * if no matrix block is configured at all (which is a valid "disabled"
 * state, not an error).
 *
 * @param projectSettingsPath Optional project-level settings.json (e.g.
 *                            ~/git/coas/.pi/settings.json) — checked first
 *                            and overrides the global file's matrix block.
 */
export function loadMatrixConfig(projectSettingsPath?: string): MatrixConfig | null {
	const projectSettings = projectSettingsPath ? readMatrixSettings(projectSettingsPath) : null;
	const globalSettings = readMatrixSettings(PI_SETTINGS_PATH);
	const raw = projectSettings ?? globalSettings;
	if (!raw) return null;

	// Required string fields
	const homeserver = requireString(raw.homeserver, "matrix.homeserver");
	const userId = requireString(raw.userId, "matrix.userId");
	const roomId = requireString(raw.roomId, "matrix.roomId");
	const targetAgent = requireString(raw.targetAgent, "matrix.targetAgent");
	const accessTokenEnv = requireString(raw.accessTokenEnv, "matrix.accessTokenEnv");

	// Validate userId / roomId formats early so we don't fail mysteriously later
	if (!userId.startsWith("@") || !userId.includes(":")) {
		throw new Error(`matrix.userId must be a Matrix MXID (e.g. "@coas-bot:matrix.org"); got "${userId}"`);
	}
	if (!roomId.startsWith("!") || !roomId.includes(":")) {
		throw new Error(`matrix.roomId must be a Matrix room ID (e.g. "!abc:matrix.org"); got "${roomId}"`);
	}

	// Resolve secrets from environment — never from the file
	const accessToken = process.env[accessTokenEnv];
	if (!accessToken) {
		throw new Error(
			`matrix: env var "${accessTokenEnv}" is not set. ` +
			`Add it to your shell rc (chmod 600) or your secrets manager.`,
		);
	}

	// Optional Secure Backup passphrase
	const secureBackupEnv = optionalString(raw.secureBackupEnv);
	const recoveryPassphrase = secureBackupEnv ? process.env[secureBackupEnv] : undefined;

	// Optional fields with sensible defaults
	const encryption = raw.encryption !== false; // default true
	const cryptoStorePath = expandHome(optionalString(raw.cryptoStorePath) ?? DEFAULT_CRYPTO_STORE);
	const deviceDisplayName = optionalString(raw.deviceDisplayName) ?? DEFAULT_DEVICE_NAME;

	return {
		homeserver,
		userId,
		roomId,
		targetAgent,
		accessToken,
		encryption,
		cryptoStorePath,
		deviceDisplayName,
		recoveryPassphrase,
	};
}

// ── Helpers ─────────────────────────────────────────────────────

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
