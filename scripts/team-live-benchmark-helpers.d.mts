/** Type declarations for the live benchmark helper module. */

export type TeamKind = "fusion-analysis" | "navigator";

export type ErrorCategory =
	| "unsupported_parameter"
	| "usage_limit"
	| "authentication"
	| "rate_limited"
	| "timeout"
	| "empty_output"
	| "invalid_output"
	| "provider_error"
	| "unknown";

export interface BenchmarkNode {
	role: string;
	model: string;
	ok: boolean;
	durationMs: number;
	errorCategory?: ErrorCategory;
}

export interface CompletedEvent {
	summary?: string;
	durationMs?: number;
}

export interface BenchmarkRun {
	exitCode: number;
	endToEndDurationMs: number;
	routingValid: boolean;
	teamDurationMs: number | null;
	schemaValid: boolean;
	judgeValid: boolean;
	degraded: boolean;
	resultValid: boolean;
	failureCategory: string | null;
	nodes: BenchmarkNode[];
}

export interface RoleModelStat {
	total: number;
	ok: number;
	errors: Record<string, number>;
}

export interface BenchmarkSummary {
	successfulRuns: number;
	validRuns: number;
	degradedRuns: number;
	nonDegradedRuns: number;
	judgeValidRuns: number;
	medianEndToEndDurationMs: number | null;
	p95EndToEndDurationMs: number | null;
	medianNonDegradedEndToEndDurationMs: number | null;
	p95NonDegradedEndToEndDurationMs: number | null;
	medianNodeDurationMs: number | null;
	p95NodeDurationMs: number | null;
	roleModelStats: Record<string, RoleModelStat>;
}

export declare const OPT_IN_ENV: string;
export declare const DEFAULT_PROMPT: string;

export declare function categorizeError(error: unknown): ErrorCategory;
export declare function summarizeSchema(summary: unknown): unknown;
export declare function fusionSchemaValid(value: unknown): boolean;
export declare function resultIsValid(team: TeamKind, completedEvent: CompletedEvent | undefined): boolean;
export declare function judgeNode(nodes: readonly BenchmarkNode[]): BenchmarkNode | undefined;
export declare function isDegraded(team: TeamKind, nodes: readonly BenchmarkNode[], completedEvent: CompletedEvent | undefined): boolean;
export declare function percentile(values: readonly number[], percentileValue: number): number | null;
export declare function summarize(runs: readonly BenchmarkRun[], team: TeamKind): BenchmarkSummary;