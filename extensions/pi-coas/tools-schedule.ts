/**
 * CoAS schedule tools.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { resolveCoasConfigForCwd } from "./config.js";
import { commandSummary } from "./format.js";
import type { PiScheduler } from "./pi-scheduler.js";
import { formatModelLabel } from "./scheduler-util.js";
import {
	addSchedule,
	formatScheduleList,
	listSchedules,
	removeSchedule,
	renderInternalSchedulePlan,
	runSchedule,
} from "./schedules.js";
import type { CoasConfig } from "./types.js";

async function _configFor(
	ctx: ExtensionContext,
	cwd?: string,
): Promise<CoasConfig> {
	return resolveCoasConfigForCwd(ctx.cwd, cwd);
}

export function registerCoasScheduleListTool(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	pi.registerTool({
		name: "coas_schedule_list",
		label: "CoAS Schedule List",
		description: "List CoAS scheduled automations from COAS_HOME.",
		promptSnippet: "List CoAS scheduled automations",
		parameters: Type.Object({
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory to resolve COAS_HOME from. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const schedules = await listSchedules(
					await _configFor(ctx, params.cwd),
				);
				return ok(formatScheduleList(schedules), {
					code: 0,
					count: schedules.length,
					schedules,
					scheduler: scheduler.snapshot(),
				});
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

export function registerCoasSchedulePreviewTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_schedule_preview",
		label: "CoAS Schedule Preview",
		description:
			"Read-only preview of enabled CoAS schedules as internal scheduler plan lines. Does not queue runs or write logs.",
		promptSnippet: "Preview enabled CoAS schedules without running them",
		parameters: Type.Object({
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory to resolve COAS_HOME from. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await renderInternalSchedulePlan(
					await _configFor(ctx, params.cwd),
				);
				return ok(commandSummary("coas-schedule preview", result), {
					code: result.code,
				});
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

export function registerCoasScheduleAddTool(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	pi.registerTool({
		name: "coas_schedule_add",
		label: "CoAS Schedule Add",
		description:
			"Add a file-backed CoAS schedule and reconcile the pi-hosted internal scheduler.",
		promptSnippet: "Add a CoAS scheduled automation to the internal scheduler",
		parameters: Type.Object({
			room: Type.String({
				description: "Target room or room alias/reference.",
			}),
			name: Type.String({ description: "Task name." }),
			cron: Type.String({ description: "Five-field schedule expression." }),
			prompt: Type.String({ description: "Prompt to run on schedule." }),
			workspace: Type.Optional(
				Type.String({ description: "Workspace id/name." }),
			),
			targetAgent: Type.Optional(
				Type.String({
					description:
						"Explicit target agent name for cross-agent delivery. Requires Gravitas/Principal approval.",
				}),
			),
			disabled: Type.Optional(
				Type.Boolean({ description: "Create disabled schedule." }),
			),
			continuation: Type.Optional(
				Type.Boolean({
					description:
						"Opt-in resumable continuation. Persist a bounded prior-run summary and inject it into the next trigger.",
				}),
			),
			approvalRequired: Type.Optional(Type.Boolean({ description: "Park each run in the principal approval inbox before delivery." })),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory to resolve COAS_HOME from. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const config = await _configFor(ctx, params.cwd);
				// Snapshot the session model at creation so the drift guard can fail
				// closed if the session later runs on a different model.
				const modelSnapshot = formatModelLabel(ctx.model);
				const schedule = await addSchedule(config, { ...params, modelSnapshot });
				if (scheduler.coasHome === config.coasHome) {
					await scheduler.reconcile(config);
				}
				return ok(`coas-schedule: added ${schedule.taskId}`, {
					code: 0,
					schedule,
					scheduler: scheduler.snapshot(),
				});
			} catch (error) {
				return fail((error as Error).message, {
					room: params.room,
					name: params.name,
				});
			}
		},
	});
}

export function registerCoasScheduleRunTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_schedule_run",
		label: "CoAS Schedule Run",
		description:
			"Dry-run a CoAS scheduled task. Enabled schedules run automatically through the pi-hosted internal scheduler while pi is open.",
		promptSnippet: "Dry-run a CoAS scheduled task",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id." }),
			dryRun: Type.Optional(
				Type.Boolean({ description: "Dry-run only. Defaults to true." }),
			),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory to resolve COAS_HOME from. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const dryRun = params.dryRun ?? true;
				const result = await runSchedule(
					await _configFor(ctx, params.cwd),
					params.taskId,
					dryRun,
				);
				return ok(commandSummary("coas-schedule run", result), {
					code: result.code,
					dryRun,
					unsupported: !dryRun,
				});
			} catch (error) {
				return fail((error as Error).message, {
					code: "internal",
					retryable: false,
					action: "Check schedule validity",
					schemaVersion: 1,
					taskId: params.taskId,
				});
			}
		},
	});
}

export function registerCoasScheduleRemoveTool(
	pi: ExtensionAPI,
	scheduler: PiScheduler,
): void {
	pi.registerTool({
		name: "coas_schedule_remove",
		label: "CoAS Schedule Remove",
		description:
			"Remove a CoAS schedule by task id and reconcile the internal scheduler.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id to remove." }),
			cwd: Type.Optional(
				Type.String({
					description:
						"Working directory to resolve COAS_HOME from. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const config = await _configFor(ctx, params.cwd);
				const message = await removeSchedule(config, params.taskId);
				if (scheduler.coasHome === config.coasHome) {
					await scheduler.reconcile(config);
				}
				return ok(message, {
					code: 0,
					taskId: params.taskId,
					scheduler: scheduler.snapshot(),
				});
			} catch (error) {
				return fail((error as Error).message, {
					code: "internal",
					retryable: false,
					action: "Check task ID exists",
					schemaVersion: 1,
					taskId: params.taskId,
				});
			}
		},
	});
}
