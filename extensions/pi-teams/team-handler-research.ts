/** Research protocol handler. */

import { ok } from "../../lib/tool-result.js";
import { TeamHandoffRouter, type TeamHandoffTargetCandidate } from "./handoff.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import { bindingForRole } from "./team-bindings.js";
import { nodeDetails, type NodeRun, runTeamNode } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, boundedLoopCount, chainText, councilSlots, promptChains, recordDetail, recordHandoff, recordNode, recordPhase, requireBinding, stoppedResult, stopRequested } from "./team-handler-shared.js";

async function runResearch(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const explorerModel = args.params.models?.members?.[0] ?? args.team.models.members?.[0] ?? settings.defaultMembers[0];
	const explicitVerifier = args.params.models?.members?.[1] ?? args.team.models.members?.[1] ?? args.team.models.synthesis ?? settings.defaultMembers[1];
	const verifierModel = explicitVerifier ?? explorerModel;
	const explicitSynthesis = args.params.models?.synthesis ?? args.team.models.synthesis ?? settings.defaultSynthesis;
	const synthesisModel = explicitSynthesis ?? explorerModel;
	if (!explicitVerifier && verifierModel) recordDetail(args, { kind: "fallback", phaseId: "research_loop_1", nodeId: "verifier_1", message: "research verifier model fell back to explorer model", data: { model: verifierModel } });
	if (!explicitSynthesis && synthesisModel) recordDetail(args, { kind: "fallback", phaseId: "research_synthesis", nodeId: "synthesis", message: "research synthesis model fell back to explorer model", data: { model: synthesisModel } });
	if (!explorerModel || !verifierModel || !synthesisModel) throw new Error("research teams need explorer, verifier, and synthesis models.");
	const maxLoops = boundedLoopCount(args.params.limits?.maxLoops ?? args.team.limits.maxLoops);
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	const explorerSource = bindingForRole(args.team.agentBindings, ["explorer", "member"]) ?? requireBinding(args.team, ["explorer", "member"]);
	const verifierSource = bindingForRole(args.team.agentBindings, ["verifier", "critic"]) ?? requireBinding(args.team, ["verifier", "critic"]);
	const synthesisSource = bindingForRole(args.team.agentBindings, ["synthesis"]) ?? requireBinding(args.team, ["synthesis"]);
	const handoffTargets: TeamHandoffTargetCandidate[] = Array.from({ length: Math.max(0, maxLoops - 1) }, (_value, index) => ({
		nodeId: `explorer_${index + 2}`,
		binding: { ...explorerSource, role: `explorer_${index + 2}`, label: explorerSource.label ?? `Explorer ${index + 2}` },
		model: explorerModel,
	}));
	const handoffRouter = new TeamHandoffRouter(handoffTargets);
	const nodes: NodeRun[] = [];
	let nextPrompt = `Original research request:\n${args.params.prompt}\n\nPlan and execute the first evidence-gathering pass. Emit a compact checklist, candidate claims, and explicit source bindings. Treat generated summaries as leads only.`;
	let verifierOutput = "";
	for (let loop = 1; loop <= maxLoops; loop++) {
		if (stopRequested(args)) return stoppedResult(args, nodes);
		const phaseId = `research_loop_${loop}`;
		recordPhase(args, phaseId, `Research loop ${loop}/${maxLoops}`);
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: explorer ${loop}/${maxLoops}`);
		const explorer = await runTeamNode({
			binding: { ...explorerSource, role: `explorer_${loop}`, label: explorerSource.label ?? `Explorer ${loop}` },
			role: `explorer_${loop}`,
			model: explorerModel,
			prompt: nextPrompt,
			systemPrompt: chainText(chains, "generation.system"),
			ctx: args.ctx,
			signal: args.signal,
			parentId: parent?.id,
			orchestratorName: parent?.name,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
		});
		recordNode(args, phaseId, explorer);
		nodes.push(explorer);
		if (!explorer.ok) return ok(explorer.output, { team: args.team.id, ok: false, maxLoops, completedLoops: loop, nodes: nodeDetails(nodes) });
		if (stopRequested(args)) return stoppedResult(args, nodes);
		args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: verifier ${loop}/${maxLoops}`);
		const verifierPrompt = `Original research request:\n${args.params.prompt}\n\nExplorer output:\n${explorer.output}\n\nAct as Evidence Auditor and Gap Detector. Reject unsupported claims, require source bindings, and emit targeted follow-up queries for remaining critical gaps. If no critical gaps remain, include the exact marker VERIFIED_COMPLETE and list the verified facts only.`;
		const verifier = await runTeamNode({
			binding: { ...verifierSource, role: `verifier_${loop}`, label: verifierSource.label ?? `Verifier ${loop}` },
			role: `verifier_${loop}`,
			model: verifierModel,
			prompt: verifierPrompt,
			systemPrompt: chainText(chains, "critique.system"),
			ctx: args.ctx,
			signal: args.signal,
			parentId: parent?.id,
			orchestratorName: parent?.name,
			timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
			maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
		});
		recordNode(args, phaseId, verifier);
		nodes.push(verifier);
		verifierOutput = verifier.output;
		if (!verifier.ok) return ok(verifier.output, { team: args.team.id, ok: false, maxLoops, completedLoops: loop, nodes: nodeDetails(nodes) });
		if (stopRequested(args)) return stoppedResult(args, nodes);
		if (verifier.output.includes("VERIFIED_COMPLETE")) {
			recordDetail(args, { kind: "trace", phaseId, nodeId: `verifier_${loop}`, message: "research verifier marked evidence complete", data: { loop } });
			break;
		}
		if (loop < maxLoops) {
			recordHandoff(args, handoffRouter, {
				phaseId,
				fromNodeId: `verifier_${loop}`,
				target: { type: "node", nodeId: `explorer_${loop + 1}` },
				message: "research verifier gaps handed to next explorer pass",
				data: { loop },
			});
			nextPrompt = `Original research request:\n${args.params.prompt}\n\nPrevious Explorer output:\n${explorer.output}\n\nVerifier gap report:\n${verifier.output}\n\nRun targeted follow-up only for the cited gaps. Preserve existing verified evidence and add new source bindings.`;
		}
	}
	if (stopRequested(args)) return stoppedResult(args, nodes);
	recordPhase(args, "research_synthesis", "Research synthesis");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: synthesis`);
	const synthesisPrompt = `Original research request:\n${args.params.prompt}\n\nVerifier-approved facts and caveats:\n${verifierOutput}\n\nWrite the final answer from verified facts only. Separate verified facts, inferences, recommendations, risks, and open questions. Include citations/source IDs for substantive claims and disclose unresolved gaps.`;
	const synthesis = await runTeamNode({
		binding: { ...synthesisSource, role: "synthesis", label: synthesisSource.label ?? "Synthesis" },
		role: "synthesis",
		model: synthesisModel,
		prompt: synthesisPrompt,
		systemPrompt: chainText(chains, "synthesis.system"),
		ctx: args.ctx,
		signal: args.signal,
		parentId: parent?.id,
		orchestratorName: parent?.name,
		timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
	});
	recordNode(args, "research_synthesis", synthesis);
	nodes.push(synthesis);
	return ok(synthesis.output, { team: args.team.id, ok: nodes.every((node) => node.ok), maxLoops, nodes: nodeDetails(nodes) });
}

export const researchHandler: TeamHandler = {
	key: "research",
	matches(team) {
		return team.protocol === "research";
	},
	modelSlots(_team, models) {
		return [
			{ id: "explorer", label: "Explorer model", current: models.members?.[0], kind: "member", index: 0 },
			{ id: "verifier", label: "Verifier model", current: models.members?.[1] ?? models.synthesis, kind: "member", index: 1 },
			{ id: "synthesis", label: "Synthesis model", current: models.synthesis, kind: "synthesis" },
		];
	},
	async run(args) {
		return runResearch(args);
	},
};
