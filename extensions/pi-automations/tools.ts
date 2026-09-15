/**
 * Automations extension model-callable tools.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { resolveAutomationsConfigForCwd } from "./config.js";
import { commandSummary } from "./format.js";
import { registerGovernanceTools } from "./governance-tools.js";
import { registerAutomationsApprovalTools } from "./tools-approval.js";
import type { PiScheduler } from "./pi-scheduler.js";
import { automationsDoctor, automationsStatus } from "./status.js";
import type { AutomationsConfig } from "./types.js";

import {
	registerAutomationsWorkspaceListTool,
	registerAutomationsWorkspaceReadTool,
	registerAutomationsWorkspaceUpdateTool,
	registerAutomationsWorkspaceCreateTool,
} from "./tools-workspace.js";
import {
	registerAutomationsScheduleListTool,
	registerAutomationsSchedulePreviewTool,
	registerAutomationsScheduleAddTool,
	registerAutomationsScheduleRunTool,
	registerAutomationsScheduleRemoveTool,
} from "./tools-schedule.js";

async function configFor(
	ctx: ExtensionContext,
	cwd?: string,
): Promise<AutomationsConfig> {
	return resolveAutomationsConfigForCwd(ctx.cwd, cwd);
}

function registerAutomationsStatusTool(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	pi.registerTool({
		name: "automations_status",
		label: "Automations Status",
		description:
			"Show fast Automations operational status from the TypeScript Automations runtime state.",
		promptSnippet: "Show fast Automations operational status",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await automationsStatus(
					await configFor(ctx),
					scheduler.snapshot(),
				);
				return ok(commandSummary("automations-status", result), { code: result.code });
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

function registerAutomationsDoctorTool(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	pi.registerTool({
		name: "automations_doctor",
		label: "Automations Doctor",
		description:
			"Run Automations TypeScript runtime diagnostics. Non-zero exit codes are returned as diagnostic details, not tool failures.",
		promptSnippet: "Run Automations health diagnostics",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await automationsDoctor(
					await configFor(ctx),
					scheduler.snapshot(),
				);
				return ok(commandSummary("automations-doctor", result), { code: result.code });
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

export function registerAutomationsTools(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	registerAutomationsStatusTool(pi, scheduler);
	registerAutomationsDoctorTool(pi, scheduler);
	registerAutomationsWorkspaceListTool(pi);
	registerAutomationsWorkspaceReadTool(pi);
	registerAutomationsWorkspaceUpdateTool(pi);
	registerAutomationsWorkspaceCreateTool(pi);
	registerAutomationsScheduleListTool(pi, scheduler);
	registerAutomationsSchedulePreviewTool(pi);
	registerAutomationsScheduleAddTool(pi, scheduler);
	registerAutomationsScheduleRunTool(pi);
	registerAutomationsScheduleRemoveTool(pi, scheduler);
	registerAutomationsApprovalTools(pi, (config, requestId) => scheduler.resumeApprovedRun(config, requestId));
	registerGovernanceTools(pi, configFor);
}
