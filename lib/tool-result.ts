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

/** Structured failure metadata for tool diagnostics. */
export interface FailureDetails extends Record<string, unknown> {
	/**
	 * Categorical failure mode for bounded diagnostics.
	 */
	code?: "validation" | "authorization" | "transient" | "timeout" | "cancelled" | "internal" | (string & {});
	/** Whether the failure might succeed if the agent simply retries. */
	retryable?: boolean;
	/** A suggested action the agent or user could take. */
	action?: string;
	/** Schema version for the diagnostics payload. */
	schemaVersion?: number;
	/** Indicates if the returned diagnostic payload or text was truncated. */
	truncated?: boolean;
	/** Tracing identifier tying this failure to a broader operation. */
	correlationId?: string;
}

/** Successful tool result with optional structured details. */
export function ok(text: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text" as const, text }], details };
}

/** Error tool result with structured backward-compatible diagnostics. */
export function fail(text: string, details: FailureDetails = {}): ToolResult {
	return { content: [{ type: "text" as const, text }], details, isError: true };
}
