/** Model-callable approval inbox tools. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { approveApproval, deferApproval, isPrincipal, listApprovalArtifacts, rejectApproval } from "./approval-inbox.js";
import { resolveCoasConfigForCwd } from "./config.js";
import { loadRunState, saveRunState } from "./scheduler-run-state.js";
import { scheduleRunsPath } from "./schedules.js";
import { isoUtc } from "./store.js";

async function configFor(ctx: ExtensionContext, cwd?: string) {
	return resolveCoasConfigForCwd(ctx.cwd, cwd);
}

function requirePrincipal(): void {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
}

export function registerCoasApprovalTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_approval_inbox_list",
		label: "CoAS Approval Inbox",
		description: "List durable scheduled-run approval requests.",
		parameters: Type.Object({ cwd: Type.Optional(Type.String()) }),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try { return ok(JSON.stringify(await listApprovalArtifacts(await configFor(ctx, params.cwd)), null, 2)); } catch (error) { return fail((error as Error).message); }
		},
	});

	for (const [name, action, handler] of [
		["coas_approval_approve", "approve", approveApproval],
		["coas_approval_reject", "reject", rejectApproval],
		["coas_approval_defer", "defer", deferApproval],
	] as const) {
		pi.registerTool({
			name,
			label: `CoAS Approval ${action}`,
			description: `Principal ${action} a scheduled-run approval request.`,
			parameters: Type.Object({ requestId: Type.String(), reason: Type.Optional(Type.String()), cwd: Type.Optional(Type.String()) }),
			async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
				try {
					requirePrincipal();
					const config = await configFor(ctx, params.cwd);
					const artifact = await handler(config, params.requestId, params.reason);
					if (artifact.status === "rejected" || artifact.status === "deferred") {
						const path = scheduleRunsPath(config, artifact.taskId);
						const state = await loadRunState(path);
						if (state?.runId === artifact.runId && state.status === "awaiting-approval") {
							await saveRunState(path, { ...state, status: "failed", reason: params.reason ?? artifact.status, lastUpdatedAt: isoUtc() });
						}
					}
					return ok(JSON.stringify(artifact), { artifact });
				} catch (error) { return fail((error as Error).message); }
			},
		});
	}
}
