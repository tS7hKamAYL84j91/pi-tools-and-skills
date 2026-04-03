/**
 * Shared tool-result helpers.
 *
 * Every pi extension tool must return `{ content, details, isError? }`.
 * These tiny helpers remove the boilerplate.
 */

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
}

/** Successful tool result with optional structured details. */
export function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text" as const, text }], details };
}

/** Error tool result. */
export function fail(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text" as const, text }], details, isError: true };
}
