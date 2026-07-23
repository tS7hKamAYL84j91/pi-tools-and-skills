/**
 * CoAS extension shared types.
 */

export interface CoasConfig {
	coasHome: string;
}

export interface RawCoasSettings {
	coasHome?: unknown;
}

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface TruncatedText {
	text: string;
	truncated: boolean;
	originalBytes: number;
	originalLines: number;
	limitHit?: "bytes" | "lines";
}

export interface WorkspaceSummary {
	id: string;
	path: string;
	roomRef?: string;
	purpose?: string;
	isolated?: string;
	updatedAt?: string;
	hasContext: boolean;
}

export type WorkspaceReadMode = "summary" | "section" | "full";

export interface WorkspaceReadOptions {
	mode?: WorkspaceReadMode;
	section?: string;
}

export interface CreateWorkspaceInput {
	workspace: string;
	room: string;
	purpose?: string;
	isolated?: boolean;
	dryRun?: boolean;
}

export interface ScheduleEntry {
	taskId: string;
	taskName: string;
	roomId: string;
	workspaceId: string;
	cronExpr: string;
	enabled: boolean;
	promptFile: string;
	createdAt?: string;
	updatedAt?: string;
	prompt?: string;
}

export interface ScheduleAddInput {
	room: string;
	name: string;
	cron: string;
	prompt: string;
	workspace?: string;
	disabled?: boolean;
}

export interface SchedulerSnapshot {
	running: boolean;
	enabledSchedules: number;
	activeRuns: number;
	startedAt?: string;
	lastError?: string;
	queued?: number;
	failed?: number;
	lastQueuedAt?: string;
	lastFailedAt?: string;
	lastTaskId?: string;
}

export interface DoctorCheck {
	level: "ok" | "warn" | "critical";
	message: string;
}

export type GovernanceIntent = "triage" | "code" | "navigator" | "review" | "unknown";

export interface ModelRoutingPolicy {
	requiresLocalOnlyForPrivateInput: boolean;
	localPrivateFallback?: string;
	localTriageOnly?: string;
	gmReviewedSimpleCode?: string;
	navigator?: string;
	advisoryFallbackChain?: string[];
}

export interface GovernanceConfig {
	localOnlyTriggers?: string[];
	modelRoutingPolicy?: ModelRoutingPolicy;
	escalationThresholds?: Record<string, number>;
	requiresLocalOnlyForPrivateInput?: boolean;
}

export interface InputClassification {
	classification: "private" | "public";
	matchedTriggers: string[];
	reason: string;
}

export type ModelResolutionSource =
	| "advisoryFallbackChain"
	| "localPrivateFallback"
	| "policyIntent"
	| "none";

export interface ModelResolution {
	resolvedModel?: string;
	source: ModelResolutionSource;
	escalate: boolean;
	reason: string;
	fallbackChain?: string[];
}
