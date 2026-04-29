/**
 * CoAS extension model-callable tools.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { resolveCoasConfig } from "./config.js";
import { commandSummary } from "./format.js";
import { runCoasScript, runDoctor, runSchedule, runStatus } from "./scripts.js";
import {
	appendWorkspaceContext,
	formatWorkspaceList,
	listWorkspaces,
	readWorkspaceContext,
} from "./workspaces.js";

function configFor(ctx: ExtensionContext): ReturnType<typeof resolveCoasConfig> {
	return resolveCoasConfig(ctx.cwd);
}

export function registerCoasTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_status",
		label: "CoAS Status",
		description: "Show fast CoAS operational status by running coas-status.",
		promptSnippet: "Show fast CoAS operational status",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await runStatus(pi, configFor(ctx), signal);
			return ok(commandSummary("coas-status", result), { code: result.code });
		},
	});

	pi.registerTool({
		name: "coas_doctor",
		label: "CoAS Doctor",
		description: "Run CoAS diagnostics. Non-zero doctor exit codes are returned as diagnostic details, not tool failures.",
		promptSnippet: "Run CoAS health diagnostics",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await runDoctor(pi, configFor(ctx), signal);
			return ok(commandSummary("coas-doctor", result), { code: result.code });
		},
	});

	pi.registerTool({
		name: "coas_workspace_list",
		label: "CoAS Workspace List",
		description: "List CoAS workspaces under COAS_HOME without modifying them.",
		promptSnippet: "List CoAS workspaces",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			const workspaces = await listWorkspaces(configFor(ctx));
			return ok(formatWorkspaceList(workspaces), { count: workspaces.length, workspaces });
		},
	});

	pi.registerTool({
		name: "coas_workspace_read",
		label: "CoAS Workspace Read",
		description: "Read a CoAS workspace CONTEXT.md. Defaults to the current workspace when cwd contains CONTEXT.md.",
		promptSnippet: "Read durable CoAS workspace context",
		parameters: Type.Object({
			workspace: Type.Optional(Type.String({ description: "Workspace id or path. Defaults to current workspace." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await readWorkspaceContext(configFor(ctx), params.workspace, ctx.cwd);
			return ok(result.text, { path: result.path });
		},
	});

	pi.registerTool({
		name: "coas_workspace_update",
		label: "CoAS Workspace Update",
		description: "Append stable, non-secret facts to a CoAS workspace CONTEXT.md using the file mutation queue.",
		promptSnippet: "Append durable facts to CoAS workspace context",
		promptGuidelines: ["Use coas_workspace_update only for stable, useful CoAS workspace facts; never store secrets in CONTEXT.md."],
		parameters: Type.Object({
			text: Type.String({ description: "Stable non-secret facts to append." }),
			workspace: Type.Optional(Type.String({ description: "Workspace id or path. Defaults to current workspace." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await appendWorkspaceContext(configFor(ctx), params.workspace, ctx.cwd, params.text);
			return ok(`Updated ${result.path}`, result);
		},
	});

	pi.registerTool({
		name: "coas_workspace_create",
		label: "CoAS Workspace Create",
		description: "Create a CoAS workspace by delegating to coas-new-room --workspace-only. Does not create a Matrix room.",
		promptSnippet: "Create a CoAS workspace without creating a Matrix room",
		parameters: Type.Object({
			room: Type.String({ description: "Room id, alias, or descriptive room reference." }),
			workspace: Type.String({ description: "Workspace id/name." }),
			purpose: Type.Optional(Type.String({ description: "Workspace purpose." })),
			isolated: Type.Optional(Type.Boolean({ description: "Mark workspace as isolated." })),
			dryRun: Type.Optional(Type.Boolean({ description: "Preview only. Defaults to false." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const args = ["--workspace-only", "--room", params.room, "--workspace", params.workspace];
			if (params.purpose) args.push("--purpose", params.purpose);
			if (params.isolated) args.push("--isolated");
			if (params.dryRun) args.push("--dry-run");
			const result = await runCoasScript(pi, configFor(ctx), "coas-new-room", { args, signal });
			if (result.code !== 0) throw new Error(commandSummary("coas-new-room", result));
			return ok(commandSummary("coas-new-room", result), { code: result.code });
		},
	});

	pi.registerTool({
		name: "coas_schedule_list",
		label: "CoAS Schedule List",
		description: "List CoAS scheduled automations via coas-schedule list.",
		promptSnippet: "List CoAS scheduled automations",
		parameters: Type.Object({}),
		async execute(_id, _params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await runSchedule(pi, configFor(ctx), ["list"], signal);
			return ok(commandSummary("coas-schedule list", result), { code: result.code });
		},
	});

	pi.registerTool({
		name: "coas_schedule_add",
		label: "CoAS Schedule Add",
		description: "Add a file-backed CoAS schedule. This writes schedule files only; it does not install cron.",
		promptSnippet: "Add a CoAS scheduled automation without installing cron",
		parameters: Type.Object({
			room: Type.String({ description: "Target room or room alias/reference." }),
			name: Type.String({ description: "Task name." }),
			cron: Type.String({ description: "Five-field cron expression." }),
			prompt: Type.String({ description: "Prompt to run on schedule." }),
			workspace: Type.Optional(Type.String({ description: "Workspace id/name." })),
			disabled: Type.Optional(Type.Boolean({ description: "Create disabled schedule." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const args = ["add", "--room", params.room, "--name", params.name, "--cron", params.cron, "--prompt", params.prompt];
			if (params.workspace) args.push("--workspace", params.workspace);
			if (params.disabled) args.push("--disabled");
			const result = await runSchedule(pi, configFor(ctx), args, signal);
			if (result.code !== 0) throw new Error(commandSummary("coas-schedule add", result));
			return ok(commandSummary("coas-schedule add", result), { code: result.code });
		},
	});

	pi.registerTool({
		name: "coas_schedule_run",
		label: "CoAS Schedule Run",
		description: "Run or dry-run a CoAS scheduled task. Defaults to dry-run for safety.",
		promptSnippet: "Dry-run or execute a CoAS scheduled task",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id." }),
			dryRun: Type.Optional(Type.Boolean({ description: "Dry-run only. Defaults to true." })),
		}),
		async execute(_id, params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const dryRun = params.dryRun ?? true;
			const args = ["run", params.taskId];
			if (dryRun) args.push("--dry-run");
			const result = await runSchedule(pi, configFor(ctx), args, signal);
			if (result.code !== 0 && !dryRun) throw new Error(commandSummary("coas-schedule run", result));
			return ok(commandSummary("coas-schedule run", result), { code: result.code, dryRun });
		},
	});

	pi.registerTool({
		name: "coas_schedule_remove",
		label: "CoAS Schedule Remove",
		description: "Remove a CoAS schedule by task id. Does not edit user crontab; run the command to reinstall cron if needed.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task id to remove." }),
		}),
		async execute(_id, params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const result = await runSchedule(pi, configFor(ctx), ["remove", params.taskId], signal);
			if (result.code !== 0) throw new Error(commandSummary("coas-schedule remove", result));
			return ok(commandSummary("coas-schedule remove", result), { code: result.code });
		},
	});
}
