/**
 * CoAS extension model-callable tools.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { resolveCoasConfigForCwd } from "./config.js";
import { commandSummary } from "./format.js";
import { registerGovernanceTools } from "./governance-tools.js";
import { registerCoasApprovalTools } from "./tools-approval.js";
import type { CoasInternalScheduler } from "./scheduler.js";
import { coasDoctor, coasStatus } from "./status.js";
import type { CoasConfig } from "./types.js";

import {
	registerCoasWorkspaceListTool,
	registerCoasWorkspaceReadTool,
	registerCoasWorkspaceUpdateTool,
	registerCoasWorkspaceCreateTool,
} from "./tools-workspace.js";
import {
	registerCoasScheduleListTool,
	registerCoasSchedulePreviewTool,
	registerCoasScheduleAddTool,
	registerCoasScheduleRunTool,
	registerCoasScheduleRemoveTool,
} from "./tools-schedule.js";

async function configFor(
	ctx: ExtensionContext,
	cwd?: string,
): Promise<CoasConfig> {
	return resolveCoasConfigForCwd(ctx.cwd, cwd);
}

function registerCoasStatusTool(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
): void {
	pi.registerTool({
		name: "coas_status",
		label: "CoAS Status",
		description:
			"Show fast CoAS operational status from the TypeScript CoAS runtime state.",
		promptSnippet: "Show fast CoAS operational status",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await coasStatus(
					await configFor(ctx),
					scheduler.snapshot(),
				);
				return ok(commandSummary("coas-status", result), { code: result.code });
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

function registerCoasDoctorTool(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
): void {
	pi.registerTool({
		name: "coas_doctor",
		label: "CoAS Doctor",
		description:
			"Run CoAS TypeScript runtime diagnostics. Non-zero exit codes are returned as diagnostic details, not tool failures.",
		promptSnippet: "Run CoAS health diagnostics",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await coasDoctor(
					await configFor(ctx),
					scheduler.snapshot(),
				);
				return ok(commandSummary("coas-doctor", result), { code: result.code });
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

export function registerCoasTools(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
): void {
	registerCoasStatusTool(pi, scheduler);
	registerCoasDoctorTool(pi, scheduler);
	registerCoasWorkspaceListTool(pi);
	registerCoasWorkspaceReadTool(pi);
	registerCoasWorkspaceUpdateTool(pi);
	registerCoasWorkspaceCreateTool(pi);
	registerCoasScheduleListTool(pi, scheduler);
	registerCoasSchedulePreviewTool(pi);
	registerCoasScheduleAddTool(pi, scheduler);
	registerCoasScheduleRunTool(pi);
	registerCoasScheduleRemoveTool(pi, scheduler);
	registerCoasApprovalTools(pi);
	registerGovernanceTools(pi, configFor);
}
