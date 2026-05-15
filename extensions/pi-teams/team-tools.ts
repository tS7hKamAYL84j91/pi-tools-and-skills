/**
 * Read-only declarative team discovery tools.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { formatPromptChains } from "./prompt-resolver.js";
import { promptChainsForTeam } from "./team-handlers.js";
import { loadTeamRegistry } from "./team-registry.js";
import type { TeamAgentBinding, TeamSpec } from "./team-types.js";

function teamOkText(text: string, details: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function teamSummary(team: TeamSpec): Record<string, unknown> {
	return {
		id: team.id,
		name: team.name,
		description: team.description,
		protocol: team.protocol,
		source: team.source,
		agents: team.agents,
		bindings: team.agentBindings.map((binding) => ({ role: binding.role, subagent: binding.subagent, model: binding.model })),
		models: team.models,
	};
}

function formatBindingLine(binding: TeamAgentBinding): string {
	const parts = [binding.role, binding.subagent];
	if (binding.model) parts.push(`model=${binding.model}`);
	if (binding.tools !== undefined) parts.push(`tools=[${binding.tools.join(", ")}]`);
	if (binding.parameters !== undefined) parts.push(`parameters=${JSON.stringify(binding.parameters)}`);
	return `  - ${parts.join(" ")}`;
}

export function registerTeamTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "team_list",
		label: "List Teams",
		description: "List declarative teams available from built-in, user, and project configuration.",
		promptSnippet: "List declarative teams available for team workflows",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx: ExtensionContext) {
			const registry = loadTeamRegistry(undefined, { cwd: ctx.cwd });
			const teams = [...registry.teams.values()];
			const lines = teams.map(
				(team) =>
					`- ${team.id}: ${team.name} | protocol=${team.protocol} | agents=${team.agents.join(", ") || "(none)"}${team.description ? ` | ${team.description}` : ""}`,
			);
			const body = lines.length > 0
				? `Teams:\n${lines.join("\n")}`
				: "No teams found.";
			return teamOkText(body, {
				teams: teams.map(teamSummary),
				warnings: registry.warnings,
			});
		},
	});

	pi.registerTool({
		name: "team_describe",
		label: "Describe Team",
		description: "Describe one declarative team and its subagent references.",
		promptSnippet: "Describe a declarative team",
		parameters: Type.Object({
			id: Type.String({ description: "Team id to describe" }),
		}),
		async execute(_id, params: { id: string }, _signal, _onUpdate, ctx: ExtensionContext) {
			const registry = loadTeamRegistry(undefined, { cwd: ctx.cwd });
			const team = registry.teams.get(params.id);
			if (!team) {
				throw new Error(
					`No team "${params.id}". Known: ${[...registry.teams.keys()].join(", ") || "(none)"}`,
				);
			}
			const agents = team.agents.map((agent) => registry.subagents.get(agent) ?? { id: agent });
			const bindingLines = team.agentBindings.map(formatBindingLine);
			const promptChains = promptChainsForTeam(team);
			const lines = [
				`${team.name} (${team.id})`,
				`Protocol: ${team.protocol}`,
				...(team.description ? [`Description: ${team.description}`] : []),
				`Agents: ${team.agents.join(", ") || "(none)"}`,
				...(bindingLines.length > 0 ? ["Agent bindings:", ...bindingLines] : []),
				...(team.models.members?.length ? [`Member models: ${team.models.members.join(", ")}`] : []),
				...(team.models.synthesis ? [`Synthesis model: ${team.models.synthesis}`] : []),
				...(team.models.driver ? [`Driver model: ${team.models.driver}`] : []),
				...(team.models.navigator ? [`Navigator model: ${team.models.navigator}`] : []),
				"Prompt chains:",
				...formatPromptChains(promptChains),
			];
			return teamOkText(lines.join("\n"), {
				team: teamSummary(team),
				agents,
				warnings: registry.warnings,
			});
		},
	});
}
