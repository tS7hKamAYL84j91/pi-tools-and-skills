/** Core contracts for bounded swarm orchestration. */

export type SwarmProfile = "fast" | "balanced" | "thorough";
export type SwarmState = "planned" | "running" | "completed" | "blocked" | "aborted";
export type SwarmTaskState = "pending" | "in_progress" | "done" | "blocked";
export type SwarmReviewProfile = "navigator" | "architecture" | "stacked";

export interface SwarmArtifact {
	path?: string;
	command?: string;
	evidence: string;
}

export type SwarmGateVerdict = "pass" | "revise" | "blocked";

export interface SwarmGateResult {
	verdict: SwarmGateVerdict;
	reason: string;
	reviews: SwarmReviewResult[];
}

export interface SwarmReviewResult {
	teamId: string;
	verdict: "pass" | "revise" | "blocked";
	summary: string;
}

export interface SwarmReviewAdapter {
	review(teamId: string, prompt: string): Promise<SwarmReviewResult>;
}

export interface SwarmTask {
	id: string;
	title: string;
	brief: string;
	dependencies: string[];
	allowedTools: string[];
	readOnly: boolean;
	reviewProfile: SwarmReviewProfile;
	state: SwarmTaskState;
	artifacts: SwarmArtifact[];
	repairCycles: number;
	lastEvidence?: string;
	workerName?: string;
}

export interface SwarmPlan {
	swarmId: string;
	goal: string;
	profile: SwarmProfile;
	state: "planned" | "blocked";
	tasks: SwarmTask[];
	blockedReason?: string;
}

export interface SwarmConfig {
	profile: SwarmProfile;
	wip: number;
	cwd: string;
}

export interface SwarmRecord {
	plan: SwarmPlan;
	state: SwarmState;
	config: SwarmConfig;
	startedAt?: number;
	finishedAt?: number;
	stopReason?: string;
}

export interface SwarmWorkerRequest {
	name: string;
	brief: string;
	cwd: string;
	model?: string;
	tools: string[];
	scope: "task";
}

export interface SwarmWorkerHandle {
	name: string;
	stop(): Promise<void>;
}

export interface SwarmWorkerAdapter {
	spawn(request: SwarmWorkerRequest): SwarmWorkerHandle;
}

