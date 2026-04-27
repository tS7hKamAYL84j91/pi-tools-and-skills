/**
 * Agent member references — parse `agent:<name>` entries in a council's
 * member list and resolve them against the panopticon registry.
 *
 * A council member can be either a model id (`openai/gpt-5.5`) or a live
 * agent reference (`agent:bob`). At resolve time the agent's underlying
 * model is read from its registry record so heterogeneity checks and
 * anonymization continue to operate on a single uniform field.
 */

import { findAgentByName } from "../../lib/agent-api.js";
import { STALE_MS } from "../../lib/agent-registry.js";
import type { CouncilMember } from "./types.js";

const AGENT_PREFIX = "agent:";

interface AgentMemberRef {
	kind: "agent";
	name: string;
}

interface ModelMemberRef {
	kind: "model";
	model: string;
}

type MemberRef = AgentMemberRef | ModelMemberRef;

function parseMemberRef(value: string): MemberRef {
	const trimmed = value.trim();
	if (trimmed.toLowerCase().startsWith(AGENT_PREFIX)) {
		return { kind: "agent", name: trimmed.slice(AGENT_PREFIX.length) };
	}
	return { kind: "model", model: trimmed };
}

export interface ResolvedAgent {
	id: string;
	name: string;
	model: string;
	alive: boolean;
	heartbeatStale: boolean;
	heartbeatAgeMs: number;
}

export interface ResolveError {
	ref: string;
	reason: string;
}

/** @public */
export interface MemberResolution {
	members: CouncilMember[];
	agents: ResolvedAgent[];
	errors: ResolveError[];
	warnings: string[];
}

/**
 * Resolve a council's raw `members: string[]` into CouncilMember records,
 * looking up live agents in the panopticon registry. Agents that don't
 * resolve are returned in `errors`; pre-flight surfaces these before launch.
 */
export function resolveMembers(rawMembers: string[]): MemberResolution {
	const members: CouncilMember[] = [];
	const agents: ResolvedAgent[] = [];
	const errors: ResolveError[] = [];
	const warnings: string[] = [];
	const seenAgents = new Set<string>();

	rawMembers.forEach((raw, index) => {
		const ref = parseMemberRef(raw);
		const label = labelFor(index);
		if (ref.kind === "model") {
			members.push({ label, model: ref.model });
			return;
		}
		const info = findAgentByName(ref.name);
		if (!info) {
			errors.push({ ref: raw, reason: `agent "${ref.name}" is not registered` });
			return;
		}
		if (!info.alive) {
			errors.push({ ref: raw, reason: `agent "${ref.name}" is not alive (status=${info.status})` });
			return;
		}
		const lower = info.name.toLowerCase();
		if (seenAgents.has(lower)) {
			warnings.push(`agent "${info.name}" appears more than once; an agent can only answer once per stage`);
		}
		seenAgents.add(lower);
		members.push({ label, model: info.model, agentName: info.name, agentId: info.id });
		agents.push({
			id: info.id,
			name: info.name,
			model: info.model,
			alive: info.alive,
			heartbeatAgeMs: info.heartbeatAge,
			heartbeatStale: info.heartbeatAge > STALE_MS,
		});
	});

	return { members, agents, errors, warnings };
}

function labelFor(index: number): string {
	return `Agent ${String.fromCharCode(65 + index)}`;
}

/** @public */
export interface ChairmanResolution {
	chairman: CouncilMember | null;
	agent?: ResolvedAgent;
	error?: ResolveError;
}

/** Resolve a chairman entry (model id or `agent:<name>`). */
export function resolveChairman(raw: string): ChairmanResolution {
	const ref = parseMemberRef(raw);
	if (ref.kind === "model") {
		return { chairman: { label: "Chairman", model: ref.model } };
	}
	const info = findAgentByName(ref.name);
	if (!info) {
		return { chairman: null, error: { ref: raw, reason: `agent "${ref.name}" is not registered` } };
	}
	if (!info.alive) {
		return { chairman: null, error: { ref: raw, reason: `agent "${ref.name}" is not alive (status=${info.status})` } };
	}
	return {
		chairman: { label: "Chairman", model: info.model, agentName: info.name, agentId: info.id },
		agent: {
			id: info.id,
			name: info.name,
			model: info.model,
			alive: info.alive,
			heartbeatAgeMs: info.heartbeatAge,
			heartbeatStale: info.heartbeatAge > STALE_MS,
		},
	};
}
