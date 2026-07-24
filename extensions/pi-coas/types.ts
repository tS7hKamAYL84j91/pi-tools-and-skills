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
	/** Optional explicit target agent for cross-agent schedules (requires Gravitas/Principal approval). */
	targetAgent?: string;
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
	lastQueuedAt?: string;
	lastFailedAt?: string;
	lastTaskId?: string;
}

export interface DoctorCheck {
	level: "ok" | "warn" | "critical";
	message: string;
}

export type { ModelRoutingPolicy } from "../../lib/coas-governance.js";
