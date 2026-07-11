/**
 * CoAS extension lifecycle hooks.
 */

import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCoasConfig } from "./config.js";
import { pathInside, workspaceRoot } from "./store.js";
import type { CoasInternalScheduler } from "./scheduler.js";
import type { SchedulerSnapshot } from "./types.js";
import { currentWorkspaceLabel } from "./workspaces.js";

export function formatCoasStatusSlot(workspace?: string, scheduler?: SchedulerSnapshot): string {
	const scope = workspace ?? "on";
	if (!scheduler) return workspace ? `coas: ${scope}` : "coas: on ✓";
	const health = scheduler.lastError ? "⚠" : scheduler.running ? "✓" : "idle";
	const scheduleText = scheduler.enabledSchedules > 0 ? ` sch ${scheduler.enabledSchedules}/${scheduler.activeRuns}` : "";
	const queued = scheduler.queued ?? 0;
	const failed = scheduler.failed ?? 0;
	const queueText = queued > 0 ? ` q${queued}` : "";
	const failText = failed > 0 ? ` f${failed}` : "";
	return `coas: ${scope} ${health}${scheduleText}${queueText}${failText}`;
}

function updateStatus(ctx: ExtensionContext, scheduler: CoasInternalScheduler): void {
	const config = resolveCoasConfig(ctx.cwd);
	const workspace = currentWorkspaceLabel(ctx.cwd);
	if (!workspace && !existsSync(config.coasHome)) {
		ctx.ui.setStatus("coas", undefined);
		return;
	}
	ctx.ui.setStatus("coas", formatCoasStatusSlot(workspace, scheduler.snapshot()));
}

function contextInstruction(ctx: ExtensionContext): string | undefined {
	const workspace = currentWorkspaceLabel(ctx.cwd);
	const config = resolveCoasConfig(ctx.cwd);
	const inWorkspaceRoot = pathInside(workspaceRoot(config), ctx.cwd);
	if (!workspace && !inWorkspaceRoot) return undefined;
	return [
		"CoAS workspace context is available for this session.",
		"Use coas_workspace_read before workspace-sensitive work when relevant.",
		"Use coas_workspace_update only for stable, useful, non-secret facts.",
	].join("\n");
}

export function registerCoasLifecycle(pi: ExtensionAPI, scheduler: CoasInternalScheduler): void {
	pi.on("session_start", async (_event, ctx) => {
		scheduler.start(resolveCoasConfig(ctx.cwd));
		updateStatus(ctx, scheduler);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		scheduler.stop();
		ctx.ui.setStatus("coas", undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		updateStatus(ctx, scheduler);
		const instruction = contextInstruction(ctx);
		if (!instruction) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${instruction}` };
	});
}
