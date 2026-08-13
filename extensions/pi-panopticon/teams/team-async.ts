/** Shared asynchronous Team result delivery. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ok, type ToolResult } from "../../../lib/tool-result.js";
import { TEAM_STATUS_KEY } from "./team-handler-shared.js";
import type { TeamRunInput } from "./team-handlers.js";

import { readTeamRunResultArtifact } from "./team-result-artifact.js";
import { resolveTeamResultRoot } from "./team-paths.js";

/** Starts a team run and delivers its terminal result using pi follow-up semantics. */
export function startTeamRunAsync(args: {
	pi: Pick<ExtensionAPI, "sendUserMessage">;
	params: TeamRunInput;
	ctx: ExtensionContext;
	resultRoot?: string;
	run: (params: TeamRunInput, resultRoot: string) => Promise<import("./team-run-completion.js").TeamRunToolResult>;
}): ToolResult {
	const resultRoot = args.resultRoot ?? resolveTeamResultRoot(args.ctx.cwd);
	void args.run({ ...args.params, async: undefined }, resultRoot)
		.then(async (result) => {
			const text = result.content.map((entry) => entry.text).join("\n");
			const runId = result.details.runId;
			const artifact = await readTeamRunResultArtifact(runId, resultRoot);
			if (artifact) {
				args.pi.sendUserMessage(`[Team "${args.params.id}" async result]\n\n${artifact.result}`, { deliverAs: "followUp" });
				return;
			}
			args.pi.sendUserMessage(`[Team "${args.params.id}" async result]\n\n${text}`, { deliverAs: "followUp" });
		})
		.catch((error: unknown) => {
			args.pi.sendUserMessage(`[Team "${args.params.id}" async failed]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
		})
		.finally(() => args.ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready"));
	return ok(`Team "${args.params.id}" started asynchronously. Result will arrive as a follow-up message.`, { team: args.params.id, async: true });
}
