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
import type { CoasInternalScheduler } from "./scheduler.js";
import {
	addSchedule,
	formatScheduleList,
	listSchedules,
	removeSchedule,
	renderInternalSchedulePlan,
	runSchedule,
} from "./schedules.js";
import { coasDoctor, coasStatus } from "./status.js";
import type { CoasConfig } from "./types.js";
import {
	appendWorkspaceContext,
	createWorkspace,
	formatWorkspaceList,
	listWorkspaces,
	readWorkspaceContext,
} from "./workspaces.js";

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

function registerCoasWorkspaceListTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_workspace_list",
		label: "CoAS Workspace List",
		description: "List CoAS workspaces under COAS_HOME without modifying them.",
		promptSnippet: "List CoAS workspaces",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const workspaces = await listWorkspaces(await configFor(ctx));
				return ok(formatWorkspaceList(workspaces), {
					count: workspaces.length,
					workspaces,
				});
			} catch (error) {
				return fail((error as Error).message);
			}
		},
	});
}

function registerCoasWorkspaceReadTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_workspace_read",
		label: "CoAS Workspace Read",
		description:
			"Read CoAS workspace CONTEXT.md with gradual disclosure. Defaults to summary metadata/headings/preview; mode=full is guarded to small files, and mode=section requires a heading.",
		promptSnippet: "Read durable CoAS workspace context summary first",
		parameters: Type.Object({
			workspace: Type.Optional(
				Type.String({
					description: "Workspace id or path. Defaults to current workspace.",
				}),
			),
			mode: Type.Optional(
				Type.Union(
					[
						Type.Literal("summary"),
						Type.Literal("section"),
						Type.Literal("full"),
					],
					{ description: "Read mode. Defaults to summary." },
				),
			),
			section: Type.Optional(
				Type.String({ description: "Heading text for mode=section." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await readWorkspaceContext(
					await configFor(ctx),
					params.workspace,
					ctx.cwd,
					{ mode: params.mode, section: params.section },
				);
				return ok(result.text, {
					path: result.path,
					mode: result.mode,
					bytes: result.bytes,
				});
			} catch (error) {
				return fail((error as Error).message, {
					selector: params.workspace,
					mode: params.mode,
					section: params.section,
				});
			}
		},
	});
}

function registerCoasWorkspaceUpdateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_workspace_update",
		label: "CoAS Workspace Update",
		description:
			"Append stable, non-secret facts to a CoAS workspace CONTEXT.md using the file mutation queue. Rejects empty text. Use coas_workspace_update only for stable, useful CoAS workspace facts; never store secrets in CONTEXT.md.",
		promptSnippet: "Append durable facts to CoAS workspace context",
		promptGuidelines: [
			"Use coas_workspace_update only for stable, useful CoAS workspace facts; never store secrets in CONTEXT.md.",
		],
		parameters: Type.Object({
			text: Type.String({ description: "Stable non-secret facts to append." }),
			workspace: Type.Optional(
				Type.String({
					description: "Workspace id or path. Defaults to current workspace.",
				}),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await appendWorkspaceContext(
					await configFor(ctx),
					params.workspace,
					ctx.cwd,
					params.text,
				);
				return ok(`Updated ${result.path}`, result);
			} catch (error) {
				return fail((error as Error).message, {
					selector: params.workspace,
					textLength: params.text.length,
				});
			}
		},
	});
}

function registerCoasWorkspaceCreateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_workspace_create",
		label: "CoAS Workspace Create",
		description:
			"Create a CoAS workspace in TypeScript. Does not create a Matrix room.",
		promptSnippet: "Create a CoAS workspace without creating a Matrix room",
		parameters: Type.Object({
			room: Type.String({
				description: "Room id, alias, or descriptive room reference.",
			}),
			workspace: Type.String({ description: "Workspace id/name." }),
			purpose: Type.Optional(
				Type.String({ description: "Workspace purpose." }),
			),
			isolated: Type.Optional(
				Type.Boolean({ description: "Mark workspace as isolated." }),
			),
			dryRun: Type.Optional(
				Type.Boolean({ description: "Preview only. Defaults to false." }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const result = await createWorkspace(await configFor(ctx), params);
				return ok(
					`coas workspace: ${result.dryRun ? "would create" : "ready"} ${result.workspaceId} at ${result.path}`,
					result,
				);
			} catch (error) {
				return fail((error as Error).message, {
					workspace: params.workspace,
					room: params.room,
				});
			}
		},
	});
}

function registerCoasScheduleListTool(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
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
				const schedules = await listSchedules(await configFor(ctx, params.cwd));
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

function registerCoasSchedulePreviewTool(pi: ExtensionAPI): void {
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
					await configFor(ctx, params.cwd),
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

function registerCoasScheduleAddTool(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
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
			disabled: Type.Optional(
				Type.Boolean({ description: "Create disabled schedule." }),
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
				const config = await configFor(ctx, params.cwd);
				const schedule = await addSchedule(config, params);
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

function registerCoasScheduleRunTool(pi: ExtensionAPI): void {
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
					await configFor(ctx, params.cwd),
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

function registerCoasScheduleRemoveTool(
	pi: ExtensionAPI,
	scheduler: CoasInternalScheduler,
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
				const config = await configFor(ctx, params.cwd);
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
}
