/** Matrix status, diagnostics, and safe error rendering helpers. */

import type { MatrixConfig } from "./types.js";

export type MatrixConnectionState =
	| "not_configured"
	| "token_unavailable"
	| "connecting"
	| "connected"
	| "disconnected"
	| "error";

interface MatrixDiagnosticInput {
	config: MatrixConfig | null;
	state: MatrixConnectionState;
	unreadCount: number;
	lastError?: string | null;
}

const SECRET_PATTERNS = [
	/syt_[A-Za-z0-9._=-]+/g,
	/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi,
	/(access[_ -]?token["':=\s]+)[^\s,"']+/gi,
];

/** Remove secrets and terminal control sequences before displaying an SDK error. */
export function sanitizeMatrixError(message: string | null | undefined): string | null {
	if (!message) {
		return null;
	}

	let sanitized = message;
	for (const pattern of SECRET_PATTERNS) {
		sanitized = sanitized.replace(pattern, (_match: string, prefix?: string) => `${prefix ?? ""}[redacted]`);
	}

	const escapeCharacter = String.fromCharCode(27);
	const bell = String.fromCharCode(7);
	sanitized = [...sanitized
		.replace(new RegExp(`${escapeCharacter}\\][^${bell}]*(?:${bell}|${escapeCharacter}\\\\)`, "g"), "")
		.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, "g"), "")]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("")
		.trim();
	return sanitized.length <= 500 ? sanitized : `${sanitized.slice(0, 499)}…`;
}

export function classifyMatrixConfigError(message: string): MatrixConnectionState {
	return /env var "[^"]+" is not set/.test(message) ? "token_unavailable" : "error";
}

export function matrixStatusText(input: MatrixDiagnosticInput): string {
	const unreadTag = input.unreadCount > 0 ? ` msg:${input.unreadCount}` : "";
	switch (input.state) {
		case "not_configured":
			return "pi-matrix: not configured";
		case "token_unavailable":
			return "pi-matrix: token unavailable";
		case "connecting":
			return "pi-matrix: connecting";
		case "connected":
			return `pi-matrix: connected${unreadTag}`;
		case "disconnected":
			return `pi-matrix: disconnected${unreadTag}`;
		case "error":
			return "pi-matrix: error";
	}
}

export function matrixDiagnosticSummary(input: MatrixDiagnosticInput): string {
	const configured = input.config || input.state !== "not_configured" ? "yes" : "no";
	const room = input.config?.roomId ?? "DM/latest inbound room";
	const policy = input.config
		? input.config.allowAnySender
			? "any sender (explicit dev/test override)"
			: input.config.trustedSenders.length > 0
				? `${input.config.trustedSenders.length} trusted sender(s)`
				: "deny all senders"
		: "unavailable until config loads";
	const lastError = sanitizeMatrixError(input.lastError) ?? "none";
	return [
		"Matrix diagnostic summary",
		`- configured: ${configured}`,
		`- connection: ${connectionLabel(input.state)}`,
		`- room: ${room}`,
		`- sender policy: ${policy}`,
		`- unread: ${input.unreadCount}`,
		`- last error: ${lastError}`,
		`- recovery: ${recoveryAction(input)}`,
	].join("\n");
}

function connectionLabel(state: MatrixConnectionState): string {
	switch (state) {
		case "not_configured":
			return "not configured";
		case "token_unavailable":
			return "token unavailable";
		case "connecting":
			return "connecting";
		case "connected":
			return "connected";
		case "disconnected":
			return "disconnected";
		case "error":
			return "connection failed";
	}
}

function recoveryAction(input: MatrixDiagnosticInput): string {
	switch (input.state) {
		case "not_configured":
			return "add a pi-matrix block to .pi/settings.json, set the token env var, then run /reload";
		case "token_unavailable":
			return "set the configured Matrix token environment variable, then run /reload";
		case "connecting":
			return "wait for sync; if it stalls, verify homeserver, network, and credentials, then run /reload";
		case "connected":
			return input.unreadCount > 0 ? "call message_read to fetch unread messages" : "no action needed";
		case "disconnected":
			return "run /reload to restart the Matrix client; if it repeats, verify homeserver and credentials";
		case "error":
			return "fix the reported Matrix error, then run /reload to reconnect";
	}
}
