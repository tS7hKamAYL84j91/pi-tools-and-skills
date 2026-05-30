/**
 * CoAS extension slash commands.
 */

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import { resolveCoasConfig } from "./config.js";
import { commandSummary, widgetLines } from "./format.js";
import { renderSchedulerSnapshot } from "./format.js";
import type { CoasInternalScheduler } from "./scheduler.js";
import { formatScheduleList, listSchedules, removeSchedule, renderInternalSchedulePlan, runSchedule } from "./schedules.js";
import { coasDoctor, coasStatus } from "./status.js";
import { formatWorkspaceList, listWorkspaces } from "./workspaces.js";

interface MutableSelectListInternals {
	filteredItems: SelectItem[];
	selectedIndex: number;
}

function selectedItem(selectList: SelectList): SelectItem | undefined {
	const internals = selectList as unknown as MutableSelectListInternals;
	return internals.filteredItems[internals.selectedIndex];
}

function coasSelectListTheme(theme: Theme): ConstructorParameters<typeof SelectList>[2] {
	return {
		selectedPrefix: (text: string) => theme.fg("accent", text),
		selectedText: (text: string) => theme.fg("accent", text.replace(/^→/, ">")),
		description: (text: string) => theme.fg("muted", text),
		scrollInfo: (text: string) => theme.fg("dim", text),
		noMatch: (text: string) => theme.fg("warning", text),
	};
}

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

async function showWorkspaceBrowser(ctx: ExtensionCommandContext): Promise<void> {
	const workspaces = await listWorkspaces(resolveCoasConfig(ctx.cwd));
	const items: SelectItem[] = workspaces.length === 0
		? [{ value: "", label: "No CoAS workspaces found", description: "esc close" }]
		: workspaces.map((workspace) => ({
				value: workspace.id,
				label: workspace.id,
				description: `${workspace.hasContext ? "CONTEXT.md" : "missing CONTEXT.md"} · ${workspace.path}${workspace.purpose ? ` · ${workspace.purpose}` : ""}`,
			}));
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), coasSelectListTheme(theme));
		selectList.onCancel = () => done();
		selectList.onSelect = (item) => {
			if (item.value) ctx.ui.notify(`CoAS workspace: ${item.value}`, "info");
			done();
		};
		return {
			render: (width: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(" CoAS Workspaces")) + theme.fg("dim", ` - ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`), 1, 0));
				container.addChild(new Text(theme.fg("dim", " type to filter · ↑/↓ navigate · enter inspect · esc close"), 1, 0));
				container.addChild(selectList);
				container.addChild(border());
				return container.render(width);
			},
			invalidate: () => selectList.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true, overlayOptions: { width: "80%", minWidth: 60, maxHeight: "80%", anchor: "center", margin: 2 } });
}

async function showScheduleBrowser(ctx: ExtensionCommandContext, scheduler: CoasInternalScheduler): Promise<void> {
	const config = resolveCoasConfig(ctx.cwd);
	const schedules = await listSchedules(config);
	const items: SelectItem[] = schedules.length === 0
		? [{ value: "", label: "No CoAS schedules found", description: "esc close" }]
		: schedules.map((schedule) => ({
				value: schedule.taskId,
				label: `${schedule.enabled ? "on " : "off"} ${schedule.taskId}`,
				description: `${schedule.cronExpr} · ${schedule.workspaceId} · ${schedule.taskName}`,
			}));
	const action = await ctx.ui.custom<{ taskId: string; action: "run" | "remove" } | null>((tui, theme, _kb, done) => {
		const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), coasSelectListTheme(theme));
		selectList.onCancel = () => done(null);
		selectList.onSelect = (item) => item.value ? done({ taskId: item.value, action: "run" }) : done(null);
		return {
			render: (width: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(" CoAS Schedules")) + theme.fg("dim", ` - ${schedules.length} schedule${schedules.length === 1 ? "" : "s"}`), 1, 0));
				container.addChild(new Text(theme.fg("dim", " type to filter · ↑/↓ navigate · enter/r dry-run · d remove · esc cancel"), 1, 0));
				container.addChild(selectList);
				container.addChild(new Text(theme.fg("dim", renderSchedulerSnapshot(scheduler.snapshot()).replace(/\n/g, " · ")), 1, 0));
				container.addChild(border());
				return container.render(width);
			},
			invalidate: () => selectList.invalidate(),
			handleInput: (data: string) => {
				if (data === "r" || data === "d") {
					const item = selectedItem(selectList);
					if (item?.value) done({ taskId: item.value, action: data === "r" ? "run" : "remove" });
					return;
				}
				selectList.handleInput(data);
				tui.requestRender();
			},
		};
	}, { overlay: true, overlayOptions: { width: "80%", minWidth: 60, maxHeight: "80%", anchor: "center", margin: 2 } });
	if (!action) return;
	if (action.action === "remove") {
		const message = await removeSchedule(config, action.taskId);
		await scheduler.reconcile(config);
		ctx.ui.notify(message, "info");
		return;
	}
	const result = await runSchedule(config, action.taskId, true);
	await showText(ctx, `CoAS schedule dry-run: ${action.taskId}`, commandSummary("coas-schedule run", result), result.code === 0 ? "info" : "warning");
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
		description: "Browse CoAS workspaces",
		handler: async (args, ctx) => {
			if (args.trim() === "--text") {
				const workspaces = await listWorkspaces(resolveCoasConfig(ctx.cwd));
				await showText(ctx, "CoAS workspaces", formatWorkspaceList(workspaces));
				return;
			}
			await showWorkspaceBrowser(ctx);
		},
	});

	pi.registerCommand("coas-schedules", {
		description: "Browse CoAS schedules and internal scheduler state",
		handler: async (args, ctx) => {
			const config = resolveCoasConfig(ctx.cwd);
			if (args.trim() === "--text") {
				const schedules = await listSchedules(config);
				const rendered = await renderInternalSchedulePlan(config);
				await showText(ctx, "CoAS schedules", `${formatScheduleList(schedules)}\n\n${renderSchedulerSnapshot(scheduler.snapshot())}\n\n${commandSummary("coas-schedule internal-plan", rendered)}`);
				return;
			}
			await showScheduleBrowser(ctx, scheduler);
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
