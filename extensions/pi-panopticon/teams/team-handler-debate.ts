/** Debate/council protocol handler. */

import { ok } from "../../../lib/tool-result.js";
import { TeamHandoffRouter } from "./handoff.js";
import { renderJoinedSynthesisPrompt, renderPeerCritiquePrompt } from "./protocol-prompts.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import { bindingForRole, roleBindings } from "./team-bindings.js";
import { nodeDetails, participantsFromRuns } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, chainText, councilSlots, memberModelSlots, promptChains, recordDetail, recordHandoff, recordPhase, requireBinding, runAndRecordNode } from "./team-handler-shared.js";
import type { TeamParticipant } from "./types.js";

async function runDebate(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const memberModels = args.params.models?.members ?? args.team.models.members ?? settings.defaultMembers;
	if (memberModels.length === 0) throw new Error("debate teams need at least one member model.");
	const explicitSynthesis = args.params.models?.synthesis ?? args.team.models.synthesis ?? settings.defaultSynthesis;
	const synthesisModel = explicitSynthesis ?? memberModels[0];
	if (!explicitSynthesis && synthesisModel) recordDetail(args, { kind: "fallback", phaseId: "debate", nodeId: "synthesis", message: "debate synthesis model fell back to first member model", data: { model: synthesisModel } });
	if (!synthesisModel) throw new Error("debate teams need a synthesis model.");
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const sourceMembers = roleBindings(args.team.agentBindings, ["member"]);
	const memberSource = sourceMembers[0] ?? requireBinding(args.team, ["member"]);
	const criticSource = bindingForRole(args.team.agentBindings, ["critic"]) ?? memberSource;
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? requireBinding(args.team, ["synthesis"]);
	const handoffRouter = new TeamHandoffRouter([{ nodeId: "synthesis", binding: synthesisSource, model: synthesisModel }]);
	recordPhase(args, "debate");
	const generation = await Promise.all(memberModels.map((model, index) => {
		const source = sourceMembers[index] ?? memberSource;
		const binding = { ...source, role: `generation_${index + 1}`, label: source.label ?? `Member ${index + 1}` };
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runAndRecordNode(args, "debate", { binding, role: binding.role, model, prompt: args.params.prompt, systemPrompt: chainText(chains, "generation.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	const members: TeamParticipant[] = generation.map((node) => ({ label: node.binding.label ?? node.role, model: node.model }));
	const okGeneration = participantsFromRuns(generation.filter((node) => node.ok));
	const critiques = await Promise.all(memberModels.map((model, index) => {
		const binding = { ...criticSource, role: `critique_${index + 1}`, label: generation[index]?.binding.label ?? `Member ${index + 1}` };
		const prompt = renderPeerCritiquePrompt({ originalPrompt: args.params.prompt, generation: okGeneration, members, viewer: { label: binding.label ?? binding.role, model }, template: chainText(chains, "critique.template").split("\n") });
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: ${binding.role}`);
		return runAndRecordNode(args, "debate", { binding, role: binding.role, model, prompt, systemPrompt: chainText(chains, "critique.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	}));
	recordHandoff(args, handoffRouter, {
		phaseId: "debate",
		fromNodeId: "critique_aggregate",
		target: { type: "node", nodeId: "synthesis" },
		message: "debate generation and critique outputs handed to synthesis",
		data: { generation: generation.length, critiques: critiques.length },
	});
	const synthesisPrompt = renderJoinedSynthesisPrompt({ originalPrompt: args.params.prompt, generation: okGeneration, critiques: participantsFromRuns(critiques.filter((node) => node.ok)), members, template: chainText(chains, "synthesis.template").split("\n") });
	const synthesis = await runAndRecordNode(args, "debate", { binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis" }, role: "synthesis", model: synthesisModel, prompt: synthesisPrompt, systemPrompt: chainText(chains, "synthesis.system"), ctx: args.ctx, parentId: parent?.id, orchestratorName: parent?.name, timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs, maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries });
	const nodes = [...generation, ...critiques, synthesis];
	return ok(synthesis.output, { team: args.team.id, ok: nodes.every((node) => node.ok), nodes: nodeDetails(nodes) });
}

export const debateHandler: TeamHandler = {
	key: "council",
	matches(team) {
		return team.protocol === "council" || team.protocol === "debate";
	},
	modelSlots(team, models) {
		return [
			...memberModelSlots({
				count: Math.max(models.members?.length ?? 0, roleBindings(team.agentBindings, ["member"]).length, 1),
				label: (index) => `Member model ${index + 1}`,
				models,
			}),
			{ id: "synthesis", label: "Synthesis model", current: models.synthesis, kind: "synthesis" },
		];
	},
	async run(args) {
		return runDebate(args);
	},
};
