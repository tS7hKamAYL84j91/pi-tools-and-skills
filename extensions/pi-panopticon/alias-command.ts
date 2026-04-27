/**
 * Alias slash command and tool registrations.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, fail, type ToolResult } from "./types.js";
import type { Registry } from "./types.js";

function validateAlias(name: string | undefined): string | undefined {
	const trimmed = name?.trim();
	if (!trimmed) {
		return undefined;
	}
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(trimmed)) {
		throw new Error(
			"Alias must start with alphanumeric, then alphanumeric/hyphens/dots/underscores",
		);
	}
	return trimmed;
}

export function registerAliasControls(pi: ExtensionAPI, registry: Registry): void {
	pi.registerCommand("alias", {
		description: "Set the current session alias. Usage: /alias <name>",
		handler: async (args: string | undefined, ctx: ExtensionContext) => {
			try {
				const alias = validateAlias(args);
				if (!alias) {
					ctx.ui.notify(
						`Current session alias: ${pi.getSessionName() ?? "(none)"}\nRegistry name: ${registry.getRecord()?.name ?? "(none)"}`,
						"info",
					);
					return;
				}
				pi.setSessionName(alias);
				registry.setName(alias);
				ctx.ui.notify(`Alias set to "${alias}"`, "info");
			} catch (err) {
				ctx.ui.notify((err as Error).message, "warning");
			}
		},
	});

	pi.registerTool({
		name: "get_alias",
		label: "Get Alias",
		description: "Get the current agent alias (session display name and registry name).",
		promptSnippet: "Get the current agent alias",
		parameters: Type.Object({}),
		async execute(): Promise<ToolResult> {
			const alias = pi.getSessionName();
			const registryName = registry.getRecord()?.name;
			return ok(`Alias: ${alias ?? registryName ?? "(none)"}`, { alias, registryName });
		},
	});

	pi.registerTool({
		name: "set_alias",
		label: "Set Alias",
		description: "Set the session alias and update the agent's registered name in the panopticon registry.",
		promptSnippet: "Set the current session alias and registry name",
		parameters: Type.Object({
			name: Type.String({ description: "Alias to use for this session" }),
		}),
		async execute(_id, params): Promise<ToolResult> {
			try {
				const alias = validateAlias(params.name);
				if (!alias) {
					return fail("Alias cannot be empty.", { reason: "empty_alias" });
				}
				pi.setSessionName(alias);
				registry.setName(alias);
				return ok(`Alias set to ${alias}.`, { alias });
			} catch (err) {
				return fail((err as Error).message, { reason: "invalid_alias" });
			}
		},
	});
}
