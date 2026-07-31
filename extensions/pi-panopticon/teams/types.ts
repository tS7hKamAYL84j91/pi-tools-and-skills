/** Shared runtime types for team protocol execution and persistence. */

export type RunStatus = "pending" | "running" | "stopping" | "stopped" | "completed" | "failed";

export interface TeamStopInput {
	runId?: string;
	reason?: string;
}

/** @public */
export type GenerationParameterValue = string | number | boolean;

export type ForkTurnsMode =
	| { mode: "none" }
	| { mode: "summary"; summary: string }
	| { mode: "lastN"; turns: readonly unknown[]; n: number };

export interface GenerationConfig {
	tools?: string[];
	parameters?: Record<string, GenerationParameterValue>;
	forkTurns?: ForkTurnsMode;
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

export type TeamRunNodeStatus = "running" | "completed" | "failed" | "stopped";

export interface TeamRunNodeRecord {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	ok: boolean;
	durationMs: number;
	output: string;
	error?: string;
	/** Lifecycle status; absent on legacy records that predate node_started events. */
	status?: TeamRunNodeStatus;
	/** Wall-clock when the node started execution (from node_started). */
	startedAt?: number;
	/** Wall-clock of the last heartbeat or state transition. */
	updatedAt?: number;
	/** Number of executing workers for this node (1 while the underlying call is in-flight, 0 if idle). */
	runningWorkers?: number;
}

/** In-flight node state for live observability. Transient; cleared on run completion. */
export interface TeamRunInFlightNode {
	phaseId: string;
	nodeId: string;
	role: string;
	model: string;
	status: "running" | "stopped";
	startedAt: number;
	updatedAt: number;
	runningWorkers: number;
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
	inFlightNodes?: TeamRunInFlightNode[];
	summary?: string;
	error?: string;
	stopReason?: string;
	/** Path to the durable result artifact, set only after a successful write. */
	resultArtifactPath?: string;
}

/** Serialized payload for a durable team-run result artifact. */
export interface TeamRunResultArtifact {
	version: 1;
	runId: string;
	team: string;
	status: "completed" | "stopped";
	ok: boolean;
	result: string;
	writtenAt: number;
}
