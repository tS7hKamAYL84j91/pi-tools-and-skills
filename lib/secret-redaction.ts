const SECRET_ASSIGNMENT_PATTERN = /\b((?=[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|pwd|credential|auth|bearer))[A-Za-z][A-Za-z0-9_.-]*)\b\s*[:=]\s*("[^"]{4,}"|'[^']{4,}'|[^\s,;)}\]]{4,})/gi;
const AUTH_HEADER_PATTERN = /\b(Authorization\s*[:=]\s*)(Bearer|Basic)\s+[^\s,;)}\]]+/gi;
const ENV_SECRET_PATTERN = /\b((?=[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|CREDENTIAL|AUTH))[A-Z][A-Z0-9_]*)=([^\s,;)}\]]{4,})/g;

/** Redact common secret-shaped values before user-visible formatting. */
export function redactSecrets(text: string): string {
	return text
		.replace(AUTH_HEADER_PATTERN, "$1$2 [REDACTED]")
		.replace(ENV_SECRET_PATTERN, "$1=[REDACTED]")
		.replace(SECRET_ASSIGNMENT_PATTERN, "$1=[REDACTED]");
}

/** JSON stringify with best-effort secret redaction for previews. */
export function redactedJsonPreview(value: unknown, maxLength: number): string {
	return redactSecrets(JSON.stringify(value)).slice(0, maxLength);
}
