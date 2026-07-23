/**
 * CoAS workspace tools.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { fail, ok, type ToolResult } from "../../lib/tool-result.js";
import { resolveCoasConfigForCwd } from "./config.js";
import type { CoasConfig } from "./types.js";
import {
	appendWorkspaceContext,
	createWorkspace,
	formatWorkspaceList,
	listWorkspaces,
	readWorkspaceContext,
} from "./workspaces.js";

async function _configFor(
	ctx: ExtensionContext,
	cwd?: string,
): Promise<CoasConfig> {
	return resolveCoasConfigForCwd(ctx.cwd, cwd);
}

export function registerCoasWorkspaceListTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "coas_workspace_list",
		label: "CoAS Workspace List",
		description: "List CoAS workspaces under COAS_HOME without modifying them.",
		promptSnippet: "List CoAS workspaces",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx): Promise<ToolResult> {
			try {
				const workspaces = await listWorkspaces(await _configFor(ctx));
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

export function registerCoasWorkspaceReadTool(pi: ExtensionAPI): void {
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
					await _configFor(ctx),
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

export function registerCoasWorkspaceUpdateTool(pi: ExtensionAPI): void {
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
					await _configFor(ctx),
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

export function registerCoasWorkspaceCreateTool(pi: ExtensionAPI): void {
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
				const result = await createWorkspace(await _configFor(ctx), params);
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
