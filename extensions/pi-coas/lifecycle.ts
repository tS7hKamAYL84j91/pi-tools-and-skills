/**
 * CoAS extension lifecycle hooks.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCoasConfig } from "./config.js";
import { pathInside, workspaceRoot } from "./store-paths.js";
import { ConfinedStore } from "./store.js";
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
	const dropped = scheduler.droppedScheduleRuns ?? 0;
	const droppedText = dropped > 0 ? ` d${dropped}` : "";
	return `coas: ${scope} ${health}${scheduleText}${queueText}${failText}${droppedText}`;
}

async function updateStatus(ctx: ExtensionContext, scheduler: CoasInternalScheduler): Promise<void> {
	const config = resolveCoasConfig(ctx.cwd);
	const workspace = await currentWorkspaceLabel(config, ctx.cwd);
	if (!workspace && !await ConfinedStore.openCoasHome(config)) {
		ctx.ui.setStatus("coas", undefined);
		return;
	}
	ctx.ui.setStatus("coas", formatCoasStatusSlot(workspace, scheduler.snapshot()));
}

async function contextInstruction(ctx: ExtensionContext): Promise<string | undefined> {
	const config = resolveCoasConfig(ctx.cwd);
	const workspace = await currentWorkspaceLabel(config, ctx.cwd);
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
		await updateStatus(ctx, scheduler);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await scheduler.stop();
		ctx.ui.setStatus("coas", undefined);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		await updateStatus(ctx, scheduler);
		const instruction = await contextInstruction(ctx);
		if (!instruction) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${instruction}` };
	});

	pi.on("agent_end", async (event, _ctx) => {
		await scheduler.handleAgentEnd(event.messages);
	});
}
