/** Model-callable approval inbox tools. */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { approveApproval, deferApproval, isPrincipal, listApprovalArtifacts, rejectApproval } from "./approval-inbox.js";
import { resolveCoasConfigForCwd } from "./config.js";
import { loadRunState, saveRunState } from "./scheduler-run-state.js";
import { isoUtc } from "./store-paths.js";

async function configFor(ctx: ExtensionContext, cwd?: string) {
	return resolveCoasConfigForCwd(ctx.cwd, cwd);
}

function requirePrincipal(): void {
	if (!isPrincipal()) throw new Error("Approval decisions require principal authority");
}

export function registerCoasApprovalTools(
	pi: ExtensionAPI,
	resumeApprovedRun: (config: Awaited<ReturnType<typeof configFor>>, requestId: string) => Promise<boolean>,
): void {
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
					if (artifact.status === "approved") {
						const resumed = await resumeApprovedRun(config, artifact.requestId);
						if (!resumed) {
							return fail(`Approval recorded, but scheduled run could not be resumed: ${artifact.requestId}`, { artifact });
						}
					} else if (artifact.status === "rejected" || artifact.status === "deferred") {
						const state = await loadRunState(config, artifact.taskId);
						if (state?.runId === artifact.runId && state.status === "awaiting-approval") {
							await saveRunState(config, artifact.taskId, { ...state, status: "failed", reason: params.reason ?? artifact.status, lastUpdatedAt: isoUtc() });
						}
					}
					return ok(JSON.stringify(artifact), { artifact });
				} catch (error) { return fail((error as Error).message); }
			},
		});
	}
}
