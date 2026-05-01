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

export interface DoctorCheck {
	level: "ok" | "warn" | "critical";
	message: string;
}
