/**
 * Default role-binding derivation for team form creation.
 */

import type { TeamAgentBinding } from "./team-types.js";
import type { TeamFormInput, TeamFormModels } from "./team-form-types.js";

function subagentIdFromTeam(teamId: string, role: string): string {
	const base = teamId.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return `${base || "team"}_${role}`;
}

function roleMatches(role: string, value: string): boolean {
	const normalized = role.toLowerCase().replaceAll("-", "_");
	return normalized === value || normalized.startsWith(`${value}_`);
}

export function defaultAgentBindings(args: TeamFormInput): TeamAgentBinding[] {
	const models = args.models ?? {};
	if (args.agentBindings && args.agentBindings.length > 0) return args.agentBindings;
	if (args.protocol === "debate") {
		const memberSubagent = args.agents[0] ?? subagentIdFromTeam(args.id, "member");
		const criticSubagents = args.agents.slice(1);
		const memberModelIds = models.members && models.members.length > 0 ? models.members : [undefined];
		return [
			...memberModelIds.map((model, index) => ({
				role: "member",
				subagent: memberSubagent,
				...(model ? { model } : {}),
				label: `Member ${index + 1}`,
			})),
			{
				role: "synthesis",
				subagent: subagentIdFromTeam(args.id, "synthesis"),
				...(models.synthesis ? { model: models.synthesis } : {}),
			},
			...criticSubagents.map((subagent) => ({ role: "critic", subagent })),
		];
	}
	if (args.protocol === "consult") {
		return args.agents.map((subagent) => ({ role: "navigator", subagent, ...(models.navigator ? { model: models.navigator } : {}) }));
	}
	if (args.protocol === "fusion-analysis") {
		const panelSubagent = args.agents[0] ?? subagentIdFromTeam(args.id, "panel");
		const panelModels = models.members && models.members.length > 0 ? models.members : [undefined];
		return [
			...panelModels.map((model, index) => ({
				role: "panel",
				subagent: panelSubagent,
				...(model ? { model } : {}),
				label: `Panel ${index + 1}`,
				tools: [],
			})),
			{ role: "judge", subagent: args.agents[1] ?? subagentIdFromTeam(args.id, "judge"), ...(models.synthesis ? { model: models.synthesis } : {}), tools: [] },
			...(models.driver ? [{ role: "fallback", subagent: args.agents[2] ?? panelSubagent, model: models.driver, tools: [] }] : []),
		];
	}
	if (args.protocol === "fusion") {
		const panelSubagent = args.agents[0] ?? subagentIdFromTeam(args.id, "panel");
		const panelModels = models.members && models.members.length > 0 ? models.members : [undefined];
		return [
			...panelModels.map((model, index) => ({
				role: "panel",
				subagent: panelSubagent,
				...(model ? { model } : {}),
				label: `Panel ${index + 1}`,
				tools: [],
			})),
			{ role: "judge", subagent: args.agents[1] ?? subagentIdFromTeam(args.id, "judge"), ...(models.synthesis ? { model: models.synthesis } : {}), tools: [] },
			{ role: "synthesis", subagent: args.agents[2] ?? subagentIdFromTeam(args.id, "synthesis"), ...(models.synthesis ? { model: models.synthesis } : {}), tools: [] },
			...(models.driver ? [{ role: "fallback", subagent: args.agents[3] ?? panelSubagent, model: models.driver, tools: [] }] : []),
		];
	}
	if (args.protocol === "research") {
		const explorer = args.agents[0] ?? subagentIdFromTeam(args.id, "explorer");
		const verifier = args.agents[1] ?? subagentIdFromTeam(args.id, "verifier");
		const synthesis = args.agents[2] ?? subagentIdFromTeam(args.id, "synthesis");
		return [
			{ role: "explorer", subagent: explorer, ...(models.members?.[0] ? { model: models.members[0] } : {}) },
			{ role: "verifier", subagent: verifier, ...(models.members?.[1] ? { model: models.members[1] } : {}) },
			{ role: "synthesis", subagent: synthesis, ...(models.synthesis ? { model: models.synthesis } : {}) },
		];
	}
	return args.agents.map((subagent) => ({ role: "agent", subagent }));
}

export function applyModelsToBindings(bindings: TeamAgentBinding[], models: TeamFormModels, allRolesAreMembers = false): TeamAgentBinding[] {
	let memberIndex = 0;
	return bindings.map((binding) => {
		if (allRolesAreMembers || roleMatches(binding.role, "member") || roleMatches(binding.role, "panel")) {
			const model = models.members?.[memberIndex];
			memberIndex++;
			return { ...binding, ...(model ? { model } : {}) };
		}
		if (roleMatches(binding.role, "synthesis")) {
			return { ...binding, ...(models.synthesis ? { model: models.synthesis } : {}) };
		}
		if (roleMatches(binding.role, "driver") || roleMatches(binding.role, "fallback")) {
			return { ...binding, ...(models.driver ? { model: models.driver } : {}) };
		}
		if (roleMatches(binding.role, "navigator")) {
			return { ...binding, ...(models.navigator ? { model: models.navigator } : {}) };
		}
		return binding;
	});
}
