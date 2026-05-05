/**
 * CoAS extension slash commands.
 */

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Container, matchesKey, Text } from "@mariozechner/pi-tui";
import { resolveCoasConfig } from "./config.js";
import { commandSummary, widgetLines } from "./format.js";
import { cronDisabled, formatScheduleList, listSchedules, renderCrontab } from "./schedules.js";
import { coasDoctor, coasStatus } from "./status.js";
import { formatWorkspaceList, listWorkspaces } from "./workspaces.js";

async function showText(ctx: ExtensionCommandContext, title: string, text: string, level: "info" | "warning" | "error" = "info"): Promise<void> {
	ctx.ui.notify(title, level);
	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const container = new Container();
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		container.addChild(border());
		container.addChild(new Text(theme.fg("accent", theme.bold(` ${title}`)), 1, 0));
		for (const line of widgetLines(text, 20)) {
			container.addChild(new Text(line, 1, 0));
		}
		container.addChild(new Text(theme.fg("dim", " esc close"), 1, 0));
		container.addChild(border());
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) done();
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			width: "70%",
			minWidth: 60,
			maxHeight: "80%",
			anchor: "center",
			margin: 2,
		},
	});
}

async function confirmCron(ctx: ExtensionCommandContext, action: string): Promise<boolean> {
	if (!ctx.hasUI) return false;
	return ctx.ui.confirm(
		`CoAS ${action}`,
		`CoAS ${action} is disabled in the TypeScript extension until a standalone runner exists. Show the disabled-result message?`,
	);
}

export function registerCoasCommands(pi: ExtensionAPI): void {
	pi.registerCommand("coas-status", {
		description: "Show fast CoAS operational status",
		handler: async (_args, ctx) => {
			const result = await coasStatus(resolveCoasConfig(ctx.cwd));
			await showText(ctx, "CoAS status", commandSummary("coas-status", result));
		},
	});

	pi.registerCommand("coas-doctor", {
		description: "Run CoAS diagnostics",
		handler: async (_args, ctx) => {
			const result = await coasDoctor(resolveCoasConfig(ctx.cwd));
			const level = result.code === 0 ? "info" : result.code === 1 ? "warning" : "error";
			await showText(ctx, `CoAS doctor exit=${result.code}`, commandSummary("coas-doctor", result), level);
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
			const schedules = await listSchedules(resolveCoasConfig(ctx.cwd));
			const rendered = await renderCrontab(resolveCoasConfig(ctx.cwd));
			await showText(ctx, "CoAS schedules", `${formatScheduleList(schedules)}\n\n${commandSummary("coas-schedule render-crontab", rendered)}`);
		},
	});

	pi.registerCommand("coas-cron-install", {
		description: "Explain why CoAS cron install is disabled in the TypeScript runtime",
		handler: async (_args, ctx) => {
			if (!await confirmCron(ctx, "install-cron")) {
				ctx.ui.notify("CoAS cron install cancelled", "info");
				return;
			}
			const result = cronDisabled("install-cron");
			await showText(ctx, "CoAS cron install disabled", commandSummary("coas-schedule install-cron", result), "warning");
		},
	});

	pi.registerCommand("coas-cron-uninstall", {
		description: "Explain why CoAS cron uninstall is disabled in the TypeScript runtime",
		handler: async (_args, ctx) => {
			if (!await confirmCron(ctx, "uninstall-cron")) {
				ctx.ui.notify("CoAS cron uninstall cancelled", "info");
				return;
			}
			const result = cronDisabled("uninstall-cron");
			await showText(ctx, "CoAS cron uninstall disabled", commandSummary("coas-schedule uninstall-cron", result), "warning");
		},
	});
}
