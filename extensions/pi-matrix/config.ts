/**
 * Matrix extension — config loader.
 *
 * Reads the `matrix` block from a project's .pi/settings.json and reads the
 * configured token environment variable. This package never writes secrets.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { PI_SETTINGS_PATH, readPiSettingsKey } from "../../lib/pi-settings.js";
import type { MatrixConfig } from "./types.js";

const DEFAULT_STORAGE_PATH = join(homedir(), ".pi", "agent", "matrix-sync");
const DEFAULT_ATTACHMENT_CACHE_PATH = join(homedir(), ".pi", "agent", "matrix-attachments");
const DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_ALLOWED_MIME_PREFIXES = ["image/", "application/pdf", "text/", "audio/", "video/"];

interface RawMatrixSettings {
	homeserver?: unknown;
	userId?: unknown;
	roomId?: unknown;
	accessTokenEnv?: unknown;
	storagePath?: unknown;
	attachmentCachePath?: unknown;
	maxAttachmentBytes?: unknown;
	allowedMimePrefixes?: unknown;
	channelLabel?: unknown;
	trustedSenders?: unknown;
	allowAnySender?: unknown;
}

function readMatrixSettings(path: string): RawMatrixSettings | null {
	const value = readPiSettingsKey("pi-matrix", path);
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as RawMatrixSettings)
		: null;
}

/**
 * Resolve the matrix config from settings + environment.
 * Returns null if no matrix block is configured.
 * Throws on validation errors.
 */
export function loadMatrixConfig(
	projectSettingsPath?: string,
): MatrixConfig | null {
	const projectSettings = projectSettingsPath
		? readMatrixSettings(projectSettingsPath)
		: null;
	const globalSettings = readMatrixSettings(PI_SETTINGS_PATH);
	const raw = projectSettings ?? globalSettings;
	if (!raw) return null;

	const homeserver = requireString(raw.homeserver, "matrix.homeserver");
	const userId = requireString(raw.userId, "matrix.userId");
	const roomId = optionalString(raw.roomId);
	const accessTokenEnv = requireString(
		raw.accessTokenEnv,
		"matrix.accessTokenEnv",
	);

	if (!userId.startsWith("@") || !userId.includes(":")) {
		throw new Error(
			`matrix.userId must be a Matrix MXID (e.g. "@agent-bot:matrix.org"); got "${userId}"`,
		);
	}
	if (roomId && !roomId.startsWith("!")) {
		throw new Error(
			`matrix.roomId must be a Matrix room ID (e.g. "!abc" or "!abc:matrix.org"); got "${roomId}"`,
		);
	}

	const accessToken = process.env[accessTokenEnv];
	if (!accessToken) {
		throw new Error(
			`matrix: env var "${accessTokenEnv}" is not set. ` +
				`Provide it from your workspace runtime or secret manager before starting pi.`,
		);
	}

	const storagePath = expandHome(
		optionalString(raw.storagePath) ?? DEFAULT_STORAGE_PATH,
	);
	const attachmentCachePath = expandHome(
		optionalString(raw.attachmentCachePath) ?? DEFAULT_ATTACHMENT_CACHE_PATH,
	);
	const maxAttachmentBytes = raw.maxAttachmentBytes === undefined
		? DEFAULT_MAX_ATTACHMENT_BYTES
		: requirePositiveInteger(raw.maxAttachmentBytes, "matrix.maxAttachmentBytes");
	const allowedMimePrefixes = Array.isArray(raw.allowedMimePrefixes)
		? (raw.allowedMimePrefixes as unknown[]).filter(
				(s): s is string => typeof s === "string" && s.length > 0,
			)
		: DEFAULT_ALLOWED_MIME_PREFIXES;
	const channelLabel = optionalString(raw.channelLabel) ?? "matrix";
	const trustedSenders = Array.isArray(raw.trustedSenders)
		? (raw.trustedSenders as unknown[]).filter(
				(s): s is string => typeof s === "string",
			)
		: [];
	const allowAnySender = raw.allowAnySender === undefined
		? false
		: requireBoolean(raw.allowAnySender, "matrix.allowAnySender");

	return {
		homeserver,
		userId,
		roomId,
		accessToken,
		storagePath,
		attachmentCachePath,
		maxAttachmentBytes,
		allowedMimePrefixes,
		channelLabel,
		trustedSenders,
		allowAnySender,
	};
}

function requireString(value: unknown, fieldName: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(
			`matrix config: ${fieldName} is required and must be a non-empty string`,
		);
	}
	return value;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length === 0) return undefined;
	return value;
}

function requirePositiveInteger(value: unknown, fieldName: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
		throw new Error(
			`matrix config: ${fieldName} must be a positive integer when provided`,
		);
	}
	return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
	if (typeof value !== "boolean") {
		throw new Error(`matrix config: ${fieldName} must be a boolean when provided`);
	}
	return value;
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (path === "~") return homedir();
	return path;
}
