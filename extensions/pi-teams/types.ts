/** Shared runtime types for team protocol execution and persistence. */

export type RunStatus = "pending" | "generating" | "critiquing" | "synthesizing" | "completed" | "failed";

/** @public */
export type GenerationParameterValue = string | number | boolean;

export interface GenerationConfig {
	tools?: string[];
	parameters?: Record<string, GenerationParameterValue>;
}

/** @public */
export interface TeamRunDefinition {
	name: string;
	purpose?: string;
	members: string[];
	chairman: string;
	createdAt: number;
	memberConfigs?: Array<GenerationConfig | undefined>;
	chairmanConfig?: GenerationConfig;
}

export interface TeamParticipant extends GenerationConfig {
	/** Protocol-local label used when packaging peer outputs. */
	label: string;
	/** Underlying model id; for live agents this is the agent's registered model. */
	model: string;
	/** Set when this participant is a live pi agent rather than a one-shot model invocation. */
	agentName?: string;
	/** Registry id of the live agent — populated alongside agentName. */
	agentId?: string;
}

/** @deprecated Use TeamRunDefinition. */
export type CouncilDefinition = TeamRunDefinition;

/** @deprecated Use TeamParticipant. */
export type CouncilMember = TeamParticipant;

export interface ModelRun {
	member: TeamParticipant;
	prompt: string;
	systemPrompt: string;
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

export interface ReviewRun extends ModelRun {
	rankings: string;
}

/** Persistent record of one team protocol run. */
export interface TeamRunRecord {
	version: 1;
	id: string;
	team: string;
	prompt: string;
	members: TeamParticipant[];
	chairman: TeamParticipant;
	status: RunStatus;
	startedAt: number;
	completedAt?: number;
	orchestratorPid: number;
	generation: ModelRun[];
	critiques: ReviewRun[];
	synthesis?: ModelRun;
	error?: string;
}
