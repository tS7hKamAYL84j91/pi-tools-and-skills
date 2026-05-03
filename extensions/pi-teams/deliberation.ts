/** Debate pre-flight validation helpers. */

import {
	type ResolvedAgent,
	type ResolveError,
	resolveChairman,
	resolveMembers,
} from "./agent-ref.js";
import { checkHeterogeneity, type HeterogeneityCheck } from "./members.js";
import type { TeamParticipant, TeamRunDefinition } from "./types.js";

/** @public */
export interface PreflightReport {
	ok: boolean;
	heterogeneity: HeterogeneityCheck;
	missingFromSnapshot: string[];
	totalCalls: number;
	reasons: string[];
	warnings: string[];
	members: TeamParticipant[];
	chairman: TeamParticipant | null;
	agents: ResolvedAgent[];
}

/** Resolve participants and validate debate model availability before launch. */
export function preflight(
	definition: TeamRunDefinition,
	availableSnapshot: string[],
): PreflightReport {
	const memberResolution = resolveMembers(definition.members);
	const chairResolution = resolveChairman(definition.chairman);
	const agents = [
		...memberResolution.agents,
		...(chairResolution.agent ? [chairResolution.agent] : []),
	];
	const errors: ResolveError[] = [
		...memberResolution.errors,
		...(chairResolution.error ? [chairResolution.error] : []),
	];
	const allMembers = [
		...memberResolution.members,
		...(chairResolution.chairman ? [chairResolution.chairman] : []),
	];
	const heterogeneity = checkHeterogeneity(allMembers.map((member) => member.model));
	const available = new Set(availableSnapshot);
	const missingFromSnapshot = availableSnapshot.length === 0
		? []
		: allMembers
				.filter((member) => !member.agentName)
				.map((member) => member.model)
				.filter((model) => !available.has(model));
	const reasons = errors.map((error) => `${error.ref}: ${error.reason}`);
	if (missingFromSnapshot.length > 0) {
		reasons.push(`Models not in registry snapshot: ${missingFromSnapshot.join(", ")}`);
	}
	const warnings = [...memberResolution.warnings];
	if (!heterogeneity.ok && heterogeneity.reason) warnings.push(heterogeneity.reason);
	for (const agent of agents) {
		if (agent.heartbeatStale) {
			warnings.push(`agent "${agent.name}" heartbeat is ${Math.round(agent.heartbeatAgeMs / 1000)}s old; may not respond in time`);
		}
	}
	return {
		ok: missingFromSnapshot.length === 0 && errors.length === 0,
		heterogeneity,
		missingFromSnapshot,
		totalCalls: definition.members.length * 2 + 1,
		reasons,
		warnings,
		members: memberResolution.members.map((member, index) => ({
			...member,
			...(definition.memberConfigs?.[index] ?? {}),
		})),
		chairman: chairResolution.chairman
			? { ...chairResolution.chairman, ...(definition.chairmanConfig ?? {}) }
			: null,
		agents,
	};
}
