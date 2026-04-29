/**
 * CoAS extension slash commands.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveCoasConfig } from "./config.js";
import { commandSummary, widgetLines } from "./format.js";
import { runDoctor, runSchedule, runStatus } from "./scripts.js";
import { formatWorkspaceList, listWorkspaces } from "./workspaces.js";

async function showText(ctx: ExtensionCommandContext, title: string, text: string): Promise<void> {
	ctx.ui.setWidget("coas", [title, ...widgetLines(text)]);
	ctx.ui.notify(title, "info");
}

async function confirmCron(ctx: ExtensionCommandContext, action: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	return ctx.ui.confirm(
		`CoAS ${action}`,
		`This will modify the current user's crontab via coas-schedule ${action}. Continue?`,
	);
}

export function registerCoasCommands(pi: ExtensionAPI): void {
	pi.registerCommand("coas-status", {
		description: "Show fast CoAS operational status",
		handler: async (_args, ctx) => {
			const result = await runStatus(pi, resolveCoasConfig(ctx.cwd));
			await showText(ctx, "CoAS status", commandSummary("coas-status", result));
		},
	});

	pi.registerCommand("coas-doctor", {
		description: "Run CoAS diagnostics",
		handler: async (_args, ctx) => {
			const result = await runDoctor(pi, resolveCoasConfig(ctx.cwd));
			const level = result.code === 0 ? "info" : result.code === 1 ? "warning" : "error";
			ctx.ui.setWidget("coas", ["CoAS doctor", ...widgetLines(commandSummary("coas-doctor", result))]);
			ctx.ui.notify(`CoAS doctor exit=${result.code}`, level);
		},
	});

	pi.registerCommand("coas-workspaces", {
		description: "List CoAS workspaces",
		handler: async (_args, ctx) => {
			const workspaces = await listWorkspaces(resolveCoasConfig(ctx.cwd));
			await showText(ctx, "CoAS workspaces", formatWorkspaceList(workspaces));
		},
	});

	pi.registerCommand("coas-schedules", {
		description: "List CoAS schedules",
		handler: async (_args, ctx) => {
			const result = await runSchedule(pi, resolveCoasConfig(ctx.cwd), ["list"]);
			await showText(ctx, "CoAS schedules", commandSummary("coas-schedule list", result));
		},
	});

	pi.registerCommand("coas-cron-install", {
		description: "Install the marked CoAS user-crontab block after confirmation",
		handler: async (_args, ctx) => {
			if (!await confirmCron(ctx, "install-cron")) {
				ctx.ui.notify("CoAS cron install cancelled", "info");
				return;
			}
			const result = await runSchedule(pi, resolveCoasConfig(ctx.cwd), ["install-cron"]);
			await showText(ctx, "CoAS cron install", commandSummary("coas-schedule install-cron", result));
		},
	});

	pi.registerCommand("coas-cron-uninstall", {
		description: "Remove the marked CoAS user-crontab block after confirmation",
		handler: async (_args, ctx) => {
			if (!await confirmCron(ctx, "uninstall-cron")) {
				ctx.ui.notify("CoAS cron uninstall cancelled", "info");
				return;
			}
			const result = await runSchedule(pi, resolveCoasConfig(ctx.cwd), ["uninstall-cron"]);
			await showText(ctx, "CoAS cron uninstall", commandSummary("coas-schedule uninstall-cron", result));
		},
	});
}
