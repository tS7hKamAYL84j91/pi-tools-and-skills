/** Dynamic, single-lifecycle execution of an ADR-040 hierarchical swarm tree. */

import { eligibleModelsFor, classifyInput, loadGovernanceConfig, type InputClassification } from "../../../../lib/coas-governance.js";
import { runAndRecordNode, recordDetail, stopRequested } from "../team-handler-shared.js";
import type { TeamHandlerRunArgs } from "../team-handler-shared.js";
import type { NodeRun } from "../team-node-runner.js";
import type { HierarchicalSwarmRole, TeamAgentBinding } from "../team-types.js";
import { canSpawn, childCapacity, rootCapacity, type HierarchicalCapacity } from "./capacity.js";
import { childRequestInstructions, parseChildRequests, type HierarchicalChildRequest } from "./protocol.js";

const PHASE_ID = "tree";

interface TreeNode {
	id: string;
	name: string;
	parentId?: string;
	parentName?: string;
	role: HierarchicalSwarmRole;
	capacity: HierarchicalCapacity;
	binding: TeamAgentBinding;
	model: string;
	classification: InputClassification;
}

interface ExecutionState {
	args: TeamHandlerRunArgs;
	startedAt: number;
	totalRemaining?: number;
	classification: InputClassification;
	localOnlyTriggers: string[];
	localModelIds: string[];
	childrenPerNode?: number;
}

function bindingForRole(args: TeamHandlerRunArgs, role: HierarchicalSwarmRole): TeamAgentBinding {
	const template = args.team.hierarchicalSwarm?.roleTemplates.find((entry) => entry.role === role);
	const binding = template && args.team.agentBindings.find((entry) => entry.role === template.bindingRole);
	if (!binding) throw new Error(`hierarchical-swarm ${role} binding is unavailable.`);
	return binding;
}

function remainingTtl(state: ExecutionState): number | undefined {
	const ttl = state.args.team.hierarchicalSwarm?.bounds.ttlMs;
	return ttl === undefined ? undefined : Math.max(0, ttl - (Date.now() - state.startedAt));
}

function stopped(state: ExecutionState): boolean {
	const ttlExpired = remainingTtl(state) === 0;
	if (ttlExpired && state.args.runId && !stopRequested(state.args)) {
		state.args.stateManager.requestStop(state.args.runId, "hierarchical swarm TTL expired");
	}
	return stopRequested(state.args) || state.args.signal?.aborted === true || ttlExpired;
}

function modelFor(state: ExecutionState, binding: TeamAgentBinding, nodeId: string, classification: InputClassification): string | undefined {
	const model = binding.model;
	if (!model) return undefined;
	const eligibility = eligibleModelsFor(classification, [model], { localModelIds: state.localModelIds });
	recordDetail(state.args, {
		kind: eligibility.escalate ? "error" : "trace",
		phaseId: PHASE_ID,
		nodeId,
		message: eligibility.escalate ? "child model eligibility escalation" : "child model eligibility accepted",
		data: { classification: classification.classification, model, localityEvidence: state.localModelIds, reason: eligibility.reason },
	});
	return eligibility.eligibleModels[0];
}

function timeoutMs(state: ExecutionState): number | undefined {
	const requested = state.args.params.limits?.timeoutMs ?? state.args.team.limits.timeoutMs;
	const ttl = remainingTtl(state);
	if (requested === undefined) return ttl;
	if (ttl === undefined) return requested;
	return Math.min(requested, ttl);
}

function nodeSystemPrompt(node: TreeNode): string {
	return [node.binding.systemPrompt ?? "", childRequestInstructions(node.role)].filter(Boolean).join("\n\n");
}

async function callNode(state: ExecutionState, node: TreeNode, prompt: string, review = false): Promise<NodeRun> {
	const model = modelFor(state, node.binding, node.id, node.classification);
	if (!model) {
		return { role: node.role, nodeId: node.id, binding: node.binding, model: node.model, ok: false, output: "", durationMs: 0, attempts: 0, error: "model eligibility escalation" };
	}
	return runAndRecordNode(state.args, PHASE_ID, {
		binding: node.binding,
		role: node.role,
		nodeId: node.id,
		model,
		prompt,
		systemPrompt: review ? `${node.binding.systemPrompt ?? ""}\n\nReview child results and return the final parent result.` : nodeSystemPrompt(node),
		ctx: state.args.ctx,
		signal: state.args.signal,
		parentId: node.parentId,
		orchestratorName: node.parentName,
		timeoutMs: timeoutMs(state),
		maxRetries: state.args.params.limits?.maxRetries ?? state.args.team.limits.maxRetries,
	});
}

function childPrompt(originalPrompt: string, parent: TreeNode, request: HierarchicalChildRequest): string {
	return `Original task:\n${originalPrompt}\n\nParent ${parent.id} delegated:\n${request.prompt}`;
}

function reviewPrompt(originalPrompt: string, children: readonly NodeRun[]): string {
	const results = children.map((child) => `[${child.nodeId ?? child.role}] ${child.ok ? child.output : `FAILED: ${child.error ?? "unknown"}`}`).join("\n\n");
	return `Original task: ${originalPrompt}\n\nReview these direct child results, resolve conflicts, and return the final result:\n${results}`;
}

async function executeNode(state: ExecutionState, node: TreeNode, prompt: string): Promise<NodeRun> {
	if (stopped(state)) return { role: node.role, nodeId: node.id, binding: node.binding, model: node.model, ok: false, output: "", durationMs: 0, attempts: 0, error: "cancelled or TTL expired" };
	const initial = await callNode(state, node, prompt);
	if (!initial.ok || !initial.output.trim() || stopped(state) || node.role === "worker") return initial;
	const requests = parseChildRequests(initial.output);
	if (requests.length === 0) return initial;
	const children: NodeRun[] = [];
	let childIndex = 0;
	for (const request of requests) {
		if (!canSpawn(node.capacity, state.totalRemaining) || stopped(state)) break;
		const childId = `${node.id}.${++childIndex}`;
		const binding = bindingForRole(state.args, request.role);
		const prompt = childPrompt(state.args.params.prompt, node, request);
		const classification = classifyInput(prompt, state.localOnlyTriggers);
		const model = modelFor(state, binding, childId, classification);
		if (!model) continue;
		if (state.totalRemaining !== undefined) state.totalRemaining--;
		node.capacity.remainingChildren = node.capacity.remainingChildren === undefined ? undefined : node.capacity.remainingChildren - 1;
		const capacity = childCapacity(node.capacity, state.totalRemaining, Date.now(), state.childrenPerNode);
		const child: TreeNode = { id: childId, name: childId, parentId: node.id, parentName: node.name, role: request.role, capacity, binding, model, classification };
		recordDetail(state.args, { kind: "trace", phaseId: PHASE_ID, nodeId: childId, message: "hierarchical child created", data: { parentId: node.id, parentName: node.name, role: request.role, classification: classification.classification, inheritedWip: capacity.availableWip, capacity } });
		children.push(await executeNode(state, child, prompt));
	}
	if (children.length === 0 || stopped(state)) return initial;
	recordDetail(state.args, { kind: "trace", phaseId: PHASE_ID, nodeId: node.id, message: "parent review started", data: { childIds: children.map((child) => child.nodeId) } });
	return callNode(state, node, reviewPrompt(state.args.params.prompt, children), true);
}

/** Executes root and descendants over the caller-owned TeamStateManager run. */
export async function executeHierarchicalTree(args: TeamHandlerRunArgs): Promise<NodeRun> {
	const hierarchy = args.team.hierarchicalSwarm;
	if (!hierarchy) throw new Error("hierarchical-swarm teams require hierarchicalSwarm configuration.");
	const config = loadGovernanceConfig(args.ctx.cwd);
	const state: ExecutionState = {
		args,
		startedAt: Date.now(),
		...(hierarchy.bounds.maxTotalNodes === undefined ? {} : { totalRemaining: hierarchy.bounds.maxTotalNodes - 1 }),
		classification: classifyInput(args.params.prompt, config.localOnlyTriggers ?? []),
		localOnlyTriggers: config.localOnlyTriggers ?? [],
		localModelIds: [...(config.modelRoutingPolicy?.localModelIds ?? [])],
		...(hierarchy.bounds.maxChildrenPerNode === undefined ? {} : { childrenPerNode: hierarchy.bounds.maxChildrenPerNode }),
	};
	const binding = bindingForRole(args, "root");
	const model = modelFor(state, binding, "root", state.classification);
	if (!model) throw new Error("hierarchical-swarm root has no eligible model; escalation required.");
	const root: TreeNode = { id: "root", name: "root", role: "root", capacity: rootCapacity(hierarchy.bounds, state.startedAt), binding, model, classification: state.classification };
	recordDetail(args, { kind: "trace", phaseId: PHASE_ID, nodeId: "root", message: "hierarchical root created", data: { capacity: root.capacity, classification: state.classification.classification } });
	return executeNode(state, root, args.params.prompt);
}
