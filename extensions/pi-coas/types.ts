/**
 * CoAS extension shared types.
 */

export interface CoasConfig {
	coasHome: string;
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
	/** Optional explicit target agent for cross-agent schedules (requires Gravitas/Principal approval). */
	targetAgent?: string;
	/** Opt-in resumable continuation: persist a bounded prior-run summary and inject it into the next trigger. */
	continuation?: boolean;
	/** Require principal approval before each scheduled run is delivered. */
	approvalRequired?: boolean;
	/** Optional maximum number of queued runs for this schedule. */
	runBudget?: number;
	/** Optional lookback window for diminishing-returns detection; defaults to 3. */
	lookback?: number;
}

export interface ScheduleAddInput {
	room: string;
	name: string;
	cron: string;
	prompt: string;
	workspace?: string;
	disabled?: boolean;
	/** Optional explicit target agent for cross-agent schedules (requires Gravitas/Principal approval). */
	targetAgent?: string;
	/** Opt-in resumable continuation for this schedule. */
	continuation?: boolean;
	/** Require principal approval before each scheduled run is delivered. */
	approvalRequired?: boolean;
	/** Optional maximum number of queued runs for this schedule. */
	runBudget?: number;
	/** Optional lookback window for diminishing-returns detection; defaults to 3. */
	lookback?: number;
}

export interface SchedulerSnapshot {
	running: boolean;
	enabledSchedules: number;
	activeRuns: number;
	startedAt?: string;
	lastError?: string;
	queued?: number;
	failed?: number;
	droppedScheduleRuns?: number;
	skippedRuns?: number;
	lastQueuedAt?: string;
	lastFailedAt?: string;
	lastTaskId?: string;
	/** Number of continuation-enabled schedules currently loaded. */
	continuationSchedules?: number;
	/** Number of continuation summaries ready for injection on the next trigger. */
	continuationReady?: number;
	/** Durable approvals awaiting a principal decision. */
	awaitingApprovalCount?: number;
	/** Number of spawned runs currently pending in the scheduler queue. */
	spawnedRuns?: number;
}

export interface DoctorCheck {
	level: "ok" | "warn" | "critical";
	message: string;
}

export type { ModelRoutingPolicy } from "../../lib/coas-governance.js";
