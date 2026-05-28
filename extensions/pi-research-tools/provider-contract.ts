/**
 * Provider contract scaffolding for future research tool adapters.
 *
 * This module is not wired to live providers. It defines provider-neutral result
 * and redaction behavior that can be tested with fakes before T-575 promotes any
 * network-backed implementation.
 */

export type ProviderResultStatus = "success" | "partial" | "failure" | "empty";

export type ProviderErrorCategory =
	| "credential_missing"
	| "rate_limited"
	| "timeout"
	| "network_error"
	| "provider_error"
	| "invalid_response"
	| "policy_blocked";

export interface ProviderErrorInfo {
	category: ProviderErrorCategory;
	message: string;
	retryable: boolean;
}

export interface ProviderObservability {
	provider: string;
	elapsedMs: number;
	resultCount: number;
	redactionCount: number;
}

export interface ProviderResearchResult {
	tool: string;
	provider: string;
	status: ProviderResultStatus;
	results?: unknown[];
	content?: string;
	sourceId?: string;
	error?: ProviderErrorInfo;
	artifactWriteStatus: "not_requested" | "not_written" | "deferred_gate";
	observability: ProviderObservability;
}

export interface ProviderRequest {
	tool: string;
	query?: string;
	url?: string;
	limit?: number;
	persistToWorkspace?: boolean;
	signal?: AbortSignal;
}

export interface ResearchProviderAdapter {
	name: string;
	execute: (request: ProviderRequest) => Promise<ProviderResearchResult>;
}

const SECRET_ASSIGNMENT_PATTERN = /\b(api[_-]?key|token|secret|authorization|cookie)=([^\s&]+)/gi;
const SECRET_HEADER_PATTERN = /\b(authorization|cookie):\s*([^\n]+)/gi;
const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|token|secret|access_token)=)([^&#]+)/gi;

export function redactResearchText(value: string): { text: string; redactionCount: number } {
	let redactionCount = 0;
	const replaceSecret = (prefix: string): string => {
		redactionCount += 1;
		return `${prefix}[REDACTED]`;
	};
	const text = value
		.replace(SECRET_HEADER_PATTERN, (_match, key: string) => replaceSecret(`${key}: `))
		.replace(SECRET_QUERY_PATTERN, (_match, prefix: string) => replaceSecret(prefix))
		.replace(SECRET_ASSIGNMENT_PATTERN, (_match, key: string) => replaceSecret(`${key}=`));
	return { text, redactionCount };
}

export function providerError(category: ProviderErrorCategory, message: string): ProviderErrorInfo {
	const retryable = category === "rate_limited" || category === "timeout" || category === "network_error";
	return { category, message: redactResearchText(message).text, retryable };
}

export function providerFailure(tool: string, provider: string, error: ProviderErrorInfo, elapsedMs: number): ProviderResearchResult {
	const redacted = redactResearchText(error.message);
	return {
		tool,
		provider,
		status: "failure",
		error: { ...error, message: redacted.text },
		artifactWriteStatus: "deferred_gate",
		observability: {
			provider,
			elapsedMs,
			resultCount: 0,
			redactionCount: redacted.redactionCount,
		},
	};
}
