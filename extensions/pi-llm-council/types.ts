/**
 * Council types — shared shape across deliberation orchestration and state
 * persistence. No sibling imports (architecture rule: types.ts is a leaf).
 */

export type CouncilStatus =
	| "pending"
	| "generating"
	| "critiquing"
	| "synthesizing"
	| "completed"
	| "failed";

/** @public */
export interface CouncilDefinition {
	name: string;
	purpose?: string;
	members: string[];
	chairman: string;
	createdAt: number;
}

export interface CouncilMember {
	/** Anonymized identifier ("Agent A", "Chairman") used in critique prompts. */
	label: string;
	/** Underlying model id; for live agents this is the agent's registered model. */
	model: string;
	/** Set when this member is a live pi agent rather than a one-shot model invocation. */
	agentName?: string;
	/** Registry id of the live agent — populated alongside agentName. */
	agentId?: string;
}

export interface ModelRun {
	member: CouncilMember;
	prompt: string;
	systemPrompt: string;
	output: string;
	durationMs: number;
	ok: boolean;
	error?: string;
}

export interface CritiqueRun extends ModelRun {
	rankings: string;
}

/**
 * Persistent record of a single council deliberation. Written incrementally
 * to ~/.pi/agent/councils/{id}.json as the 3-stage protocol progresses, so
 * an orchestrator crash mid-deliberation leaves a recoverable trail.
 */
export interface CouncilDeliberation {
	version: 1;
	id: string;
	council: string;
	prompt: string;
	members: CouncilMember[];
	chairman: CouncilMember;
	status: CouncilStatus;
	startedAt: number;
	completedAt?: number;
	orchestratorPid: number;
	generation: ModelRun[];
	critiques: CritiqueRun[];
	synthesis?: ModelRun;
	error?: string;
}
