/** Internal handoff validation, target resolution, and runtime routing helpers. */

import type { TeamAgentBinding } from "./team-types.js";

const NODE_ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/i;

export type TeamHandoffTargetType = "node";

export interface TeamHandoffTarget {
	type: TeamHandoffTargetType;
	nodeId: string;
}

export interface TeamHandoff {
	phaseId: string;
	fromNodeId: string;
	target: TeamHandoffTarget;
	message: string;
	data?: Record<string, unknown>;
}

export interface TeamHandoffTargetCandidate {
	nodeId: string;
	binding?: TeamAgentBinding;
	model?: string;
}

interface TeamHandoffRoute {
	handoff: TeamHandoff;
	target: Required<TeamHandoffTargetCandidate>;
}

interface TeamHandoffRoutingError {
	index: number;
	message: string;
}

interface TeamHandoffRoutingResult {
	routes: TeamHandoffRoute[];
	errors: TeamHandoffRoutingError[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requireNodeId(value: unknown, field: string): string {
	if (typeof value !== "string" || !NODE_ID_PATTERN.test(value)) throw new Error(`Invalid handoff ${field}; expected a bounded node id.`);
	return value;
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`Invalid handoff ${field}; expected a non-empty string.`);
	return value;
}

/** Validate the current internal handoff schema and reject free-form targets. */
export function parseTeamHandoff(value: unknown): TeamHandoff {
	const record = asRecord(value);
	if (!record) throw new Error("Invalid handoff; expected an object.");
	const target = asRecord(record.target);
	if (!target) throw new Error("Invalid handoff target; expected an object target.");
	if (target.type !== "node") throw new Error("Invalid handoff target type; allowed target types: node.");
	const data = record.data === undefined ? undefined : asRecord(record.data);
	if (record.data !== undefined && !data) throw new Error("Invalid handoff data; expected an object.");
	return {
		phaseId: requireNodeId(record.phaseId, "phaseId"),
		fromNodeId: requireNodeId(record.fromNodeId, "fromNodeId"),
		target: { type: "node", nodeId: requireNodeId(target.nodeId, "target.nodeId") },
		message: requireNonEmptyString(record.message, "message"),
		...(data ? { data } : {}),
	};
}

/** Resolve a schema-valid handoff target against an explicit node allow-list. */
export function resolveHandoffTarget(handoff: TeamHandoff, candidates: readonly TeamHandoffTargetCandidate[]): TeamHandoffTargetCandidate {
	const target = candidates.find((candidate) => candidate.nodeId === handoff.target.nodeId);
	if (!target) throw new Error(`Unknown handoff target node "${handoff.target.nodeId}".`);
	return target;
}

function resolveRuntimeHandoffTarget(handoff: TeamHandoff, candidates: readonly TeamHandoffTargetCandidate[]): Required<TeamHandoffTargetCandidate> {
	const target = resolveHandoffTarget(handoff, candidates);
	if (!target.binding || !target.model) throw new Error(`Handoff target node "${target.nodeId}" is not runtime-routable.`);
	return { nodeId: target.nodeId, binding: target.binding, model: target.model };
}

/** Stateful runtime router that rejects circular handoff edges within one run. */
export class TeamHandoffRouter {
	private readonly edges = new Map<string, string>();

	constructor(private readonly candidates: readonly TeamHandoffTargetCandidate[]) {}

	route(value: unknown): TeamHandoffRoute {
		const handoff = parseTeamHandoff(value);
		const target = resolveRuntimeHandoffTarget(handoff, this.candidates);
		this.assertAcyclic(handoff.fromNodeId, target.nodeId);
		this.edges.set(handoff.fromNodeId, target.nodeId);
		return { handoff, target };
	}

	private assertAcyclic(fromNodeId: string, toNodeId: string): void {
		if (fromNodeId === toNodeId) throw new Error(`Circular handoff from "${fromNodeId}" to itself.`);
		let current = toNodeId;
		const seen = new Set<string>();
		while (current) {
			if (current === fromNodeId) throw new Error(`Circular handoff detected for "${fromNodeId}" -> "${toNodeId}".`);
			if (seen.has(current)) return;
			seen.add(current);
			const next = this.edges.get(current);
			if (!next) return;
			current = next;
		}
	}
}

/** Route a batch while preserving valid routes when later handoffs fail. */
export function routeTeamHandoffs(values: readonly unknown[], candidates: readonly TeamHandoffTargetCandidate[]): TeamHandoffRoutingResult {
	const router = new TeamHandoffRouter(candidates);
	const routes: TeamHandoffRoute[] = [];
	const errors: TeamHandoffRoutingError[] = [];
	for (const [index, value] of values.entries()) {
		try {
			routes.push(router.route(value));
		} catch (error) {
			errors.push({ index, message: error instanceof Error ? error.message : String(error) });
		}
	}
	return { routes, errors };
}
