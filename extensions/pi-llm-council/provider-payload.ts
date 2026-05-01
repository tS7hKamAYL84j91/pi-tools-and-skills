/**
 * Provider payload helpers for council child model calls.
 *
 * Some OpenAI-compatible providers reject `tools: []`; no-tools requests must
 * omit the field entirely while preserving non-empty tool definitions.
 */
export function omitEmptyTools(payload: unknown): unknown {
	if (!isRecord(payload) || !Object.hasOwn(payload, "tools")) {
		return payload;
	}

	const tools = payload.tools;
	if (!Array.isArray(tools) || tools.length > 0) {
		return payload;
	}

	const sanitized = { ...payload };
	delete sanitized.tools;
	return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
