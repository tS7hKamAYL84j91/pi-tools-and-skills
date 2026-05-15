/**
 * CoAS extension slash commands.
 */

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, Text } from "@earendil-works/pi-tui";
import { resolveCoasConfig } from "./config.js";
import { commandSummary, widgetLines } from "./format.js";
import { renderSchedulerSnapshot } from "./format.js";
import type { CoasInternalScheduler } from "./scheduler.js";
import { formatScheduleList, listSchedules, renderInternalSchedulePlan } from "./schedules.js";
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

export function registerCoasCommands(pi: ExtensionAPI, scheduler: CoasInternalScheduler): void {
	pi.registerCommand("coas-status", {
		description: "Show fast CoAS operational status",
		handler: async (_args, ctx) => {
			const result = await coasStatus(resolveCoasConfig(ctx.cwd), scheduler.snapshot());
			await showText(ctx, "CoAS status", commandSummary("coas-status", result));
		},
	});

	pi.registerCommand("coas-doctor", {
		description: "Run CoAS diagnostics",
		handler: async (_args, ctx) => {
			const result = await coasDoctor(resolveCoasConfig(ctx.cwd), scheduler.snapshot());
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
		description: "List CoAS schedules and internal scheduler state",
		handler: async (_args, ctx) => {
			const config = resolveCoasConfig(ctx.cwd);
			const schedules = await listSchedules(config);
			const rendered = await renderInternalSchedulePlan(config);
			await showText(ctx, "CoAS schedules", `${formatScheduleList(schedules)}\n\n${renderSchedulerSnapshot(scheduler.snapshot())}\n\n${commandSummary("coas-schedule internal-plan", rendered)}`);
		},
	});

	pi.registerCommand("coas-scheduler", {
		description: "Show and reconcile the CoAS internal scheduler",
		handler: async (_args, ctx) => {
			await scheduler.reconcile(resolveCoasConfig(ctx.cwd));
			await showText(ctx, "CoAS scheduler", renderSchedulerSnapshot(scheduler.snapshot()));
		},
	});
}
