/**
 * Core declarative team types.
 */

import type { GenerationConfig } from "./types.js";

export type TeamProtocol = string;
export type TeamPromptRefs = Record<string, string>;
export type TeamSource = "builtin" | "user" | "project";
export type TeamWritableSource = Exclude<TeamSource, "builtin">;

export interface SubagentSpec extends GenerationConfig {
	id: string;
	name: string;
	description?: string;
	promptId?: string;
	model?: string;
	systemPrompt?: string;
	source: TeamSource;
	path: string;
}

export interface TeamModels {
	members?: string[];
	synthesis?: string;
	driver?: string;
	navigator?: string;
}

export interface TeamAgentBinding extends GenerationConfig {
	role: string;
	subagent: string;
	model?: string;
	label?: string;
	promptId?: string;
	templateId?: string;
	systemPrompt?: string;
	maxRetries?: number;
	subagentPromptId?: string;
	subagentSystemPrompt?: string;
}

export type TeamPromptSlotKind = "system" | "template";
export type TeamModelSlotKind = "member" | "synthesis" | "driver" | "navigator";
export type TeamModelSlotCount = number | "dynamic";

export interface TeamPromptContract {
	id: string;
	kind: TeamPromptSlotKind;
	defaultPromptId?: string;
	roles?: string[];
}

export interface TeamModelSlotSpec {
	id: string;
	kind: TeamModelSlotKind;
	count?: TeamModelSlotCount;
	label?: string;
}

export interface TeamApprovalConfig {
	enabled?: boolean;
	owner?: string;
	source?: "human" | "orchestrator" | "policy";
}

export interface TeamLimits {
	timeoutMs?: number;
	maxFixPasses?: number;
	maxConcurrency?: number;
	maxRetries?: number;
	maxLoops?: number;
}

/** Authority assigned to a node in a hierarchical swarm tree. */
export type HierarchicalSwarmRole = "root" | "manager" | "worker";

/** Review required before a node's result may be accepted by its parent. */
export interface HierarchicalSwarmReviewBinding {
	reviewerRole: "root" | "manager";
	required: boolean;
}

/** Maps a runtime role to an existing manifest agent binding. */
export interface HierarchicalSwarmRoleTemplate {
	role: HierarchicalSwarmRole;
	bindingRole: string;
	review: HierarchicalSwarmReviewBinding;
}

/** The tree-wide write policy; a worktree exception requires explicit approval. */
export interface HierarchicalSwarmWriteIsolation {
	mode: "tree-global-exclusive";
	approvedWorktreePolicy?: string;
}

/** User-configurable limits; an omitted numeric value is unbounded. */
export interface HierarchicalSwarmBounds {
	maxDepth?: number;
	maxChildrenPerNode?: number;
	maxTotalNodes?: number;
	maxWip?: number;
	maxRepairCycles?: number;
	ttlMs?: number;
	writeIsolation: HierarchicalSwarmWriteIsolation;
}

/** Manifest contract for the bounded hierarchical-swarm protocol. */
export interface HierarchicalSwarmConfig {
	roleTemplates: HierarchicalSwarmRoleTemplate[];
	bounds: HierarchicalSwarmBounds;
}

/** @public Capacity passed from a parent to a runtime child; children cannot increase it. */
export interface HierarchicalSwarmInheritedCapacity {
	remainingDepth?: number;
	remainingChildren?: number;
	remainingTotalNodes?: number;
	availableWip?: number;
	remainingTtlMs?: number;
	remainingRepairCycles?: number;
	writeIsolation: HierarchicalSwarmWriteIsolation;
}

/** @public Runtime-tree contract only; Phase 0 does not create or execute these nodes. */
export interface HierarchicalSwarmRuntimeNode {
	id: string;
	parentId?: string;
	role: HierarchicalSwarmRole;
	capacity: HierarchicalSwarmInheritedCapacity;
	review: HierarchicalSwarmReviewBinding;
}

export interface TeamSpec {
	schemaVersion: 2;
	id: string;
	name: string;
	description?: string;
	protocol: TeamProtocol;
	prompts: TeamPromptRefs;
	promptContracts?: TeamPromptContract[];
	modelSlots?: TeamModelSlotSpec[];
	hierarchicalSwarm?: HierarchicalSwarmConfig;
	agents: string[];
	agentBindings: TeamAgentBinding[];
	models: TeamModels;
	limits: TeamLimits;
	approval?: TeamApprovalConfig;
	source: TeamSource;
	path: string;
}

export interface TeamRegistry {
	teams: Map<string, TeamSpec>;
	subagents: Map<string, SubagentSpec>;
	warnings: string[];
}

export interface TeamDirectories {
	root: string;
	agents: string;
	prompts: string;
	teams: string;
	source: TeamSource;
}

export interface TeamRegistryOptions {
	cwd?: string;
	settingsPath?: string;
	roots?: string[];
}
