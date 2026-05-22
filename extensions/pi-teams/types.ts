/** Shared runtime types for team protocol execution and persistence. */

export type RunStatus = "pending" | "running" | "stopping" | "stopped" | "completed" | "failed";

/** @public */
export type GenerationParameterValue = string | number | boolean;

export interface GenerationConfig {
	tools?: string[];
	parameters?: Record<string, GenerationParameterValue>;
}

export interface TeamParticipant extends GenerationConfig {
	/** Protocol-local label used when packaging peer outputs. */
	label: string;
	/** Underlying model id; for live agents this is the agent's registered model. */
	model: string;
	/** Set when this participant is a live pi agent rather than a one-shot model invocation. */
	agentName?: string;
	/** Registry id of the live agent - populated alongside agentName. */
	agentId?: string;
}

export interface ModelRun {
	member: TeamParticipant;
	prompt: string;
	systemPrompt: string;
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

export type TeamRunDetailKind = "trace" | "handoff" | "fallback" | "artifact" | "error";

export interface TeamRunDetailRecord {
	kind: TeamRunDetailKind;
	phaseId?: string;
	nodeId?: string;
	message: string;
	data?: Record<string, unknown>;
	artifactUri?: string;
	error?: string;
	timestamp: number;
}

export interface TeamRunNodeRecord {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	ok: boolean;
	durationMs: number;
	output: string;
	error?: string;
}

/** Persistent record of one team protocol run. */
export interface TeamRunRecord {
	version: 1;
	id: string;
	team: string;
	protocol?: string;
	prompt: string;
	status: RunStatus;
	startedAt: number;
	completedAt?: number;
	orchestratorPid: number;
	phases: string[];
	nodes: TeamRunNodeRecord[];
	details: TeamRunDetailRecord[];
	summary?: string;
	error?: string;
	stopReason?: string;
}
