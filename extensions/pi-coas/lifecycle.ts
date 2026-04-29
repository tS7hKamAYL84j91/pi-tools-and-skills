/**
 * CoAS extension lifecycle hooks.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { hasCoasScripts, resolveCoasConfig } from "./config.js";
import { currentWorkspaceLabel } from "./workspaces.js";

function updateStatus(ctx: ExtensionContext): void {
	const config = resolveCoasConfig(ctx.cwd);
	if (!hasCoasScripts(config)) {
		ctx.ui.setStatus("coas", undefined);
		return;
	}
	const workspace = currentWorkspaceLabel(ctx.cwd);
	ctx.ui.setStatus("coas", workspace ? `CoAS ${workspace}` : "CoAS ✓");
}

function contextInstruction(ctx: ExtensionContext): string | undefined {
	const workspace = currentWorkspaceLabel(ctx.cwd);
	if (!workspace && !existsSync(join(ctx.cwd, "CONTEXT.md"))) return undefined;
	return [
		"CoAS workspace context is available for this session.",
		"Use coas_workspace_read before workspace-sensitive work when relevant.",
		"Use coas_workspace_update only for stable, useful, non-secret facts.",
	].join("\n");
}

export function registerCoasLifecycle(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus("coas", undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		updateStatus(ctx);
		const instruction = contextInstruction(ctx);
		if (!instruction) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${instruction}` };
	});
}
