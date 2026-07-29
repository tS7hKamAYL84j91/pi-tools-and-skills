/** Shared asynchronous Team result delivery. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ok, type ToolResult } from "../../../lib/tool-result.js";
import { TEAM_STATUS_KEY } from "./team-handler-shared.js";
import type { TeamRunInput } from "./team-handlers.js";

/** Starts a team run and delivers its terminal result using pi follow-up semantics. */
export function startTeamRunAsync(args: {
	pi: Pick<ExtensionAPI, "sendUserMessage">;
	params: TeamRunInput;
	ctx: ExtensionContext;
	run: (params: TeamRunInput) => Promise<ToolResult>;
}): ToolResult {
	void args.run({ ...args.params, async: undefined })
		.then((result) => {
			const text = result.content.map((entry) => entry.text).join("\n");
			args.pi.sendUserMessage(`[Team "${args.params.id}" async result]\n\n${text}`, { deliverAs: "followUp" });
		})
		.catch((error: unknown) => {
			args.pi.sendUserMessage(`[Team "${args.params.id}" async failed]\n\n${error instanceof Error ? error.message : String(error)}`, { deliverAs: "followUp" });
		})
		.finally(() => args.ctx.ui.setStatus(TEAM_STATUS_KEY, "teams: ready"));
	return ok(`Team "${args.params.id}" started asynchronously. Result will arrive as a follow-up message.`, { team: args.params.id, async: true });
}
