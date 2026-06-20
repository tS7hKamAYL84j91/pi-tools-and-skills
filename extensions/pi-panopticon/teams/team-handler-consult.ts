/** Consult protocol handler. */

import { ok } from "../../../lib/tool-result.js";
import { isLiveAgentRef, liveAgentModel } from "./live-agent.js";
import { renderTemplate } from "./prompt-renderer.js";
import { currentPanopticonRecord } from "./runner.js";
import { resolveTeamSettings } from "./settings.js";
import { nodeDetails } from "./team-node-runner.js";
import type { TeamHandler, TeamHandlerResult, TeamHandlerRunArgs } from "./team-handler-shared.js";
import { TEAM_STATUS_KEY, chainText, councilSlots, promptChains, recordDetail, recordPhase, requireBinding, runAndRecordNode } from "./team-handler-shared.js";

async function runConsult(args: TeamHandlerRunArgs): Promise<TeamHandlerResult> {
	const settings = resolveTeamSettings();
	const binding = requireBinding(args.team, ["navigator"]);
	const model = args.params.models?.navigator ?? args.team.models.navigator ?? (isLiveAgentRef(binding.subagent) ? liveAgentModel(binding.subagent) : settings.defaultConsult?.navigator);
	recordDetail(args, { kind: "trace", phaseId: "consult", nodeId: "navigator", message: "consult navigator selected", data: { role: binding.role, model } });
	if (!model) throw new Error("consult teams need a navigator model or live-agent binding.");
	const chains = promptChains(args.team, councilSlots(args.team));
	const parent = await currentPanopticonRecord(args.ctx.cwd);
	recordPhase(args, "consult");
	args.ctx.ui.setStatus(TEAM_STATUS_KEY, `${args.team.id}: consult navigator`);
	const node = await runAndRecordNode(args, "consult", {
		binding: { ...binding, role: "navigator" },
		role: "navigator",
		model,
		prompt: renderTemplate(chainText(chains, "navigator.template").split("\n"), { prompt: args.params.prompt }),
		systemPrompt: chainText(chains, "navigator.system"),
		ctx: args.ctx,
		parentId: parent?.id,
		orchestratorName: parent?.name,
		timeoutMs: args.params.limits?.timeoutMs ?? args.team.limits.timeoutMs,
		maxRetries: args.params.limits?.maxRetries ?? args.team.limits.maxRetries,
	});
	return ok(node.output, { team: args.team.id, ok: node.ok, nodes: nodeDetails([node]) });
}

export const consultHandler: TeamHandler = {
	key: "council",
	matches(team) {
		return team.protocol === "consult";
	},
	modelSlots(_team, models) {
		return [{ id: "navigator", label: "Navigator model", current: models.navigator, kind: "navigator" }];
	},
	async run(args) {
		return runConsult(args);
	},
};
