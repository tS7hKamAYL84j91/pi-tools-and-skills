/**
 * Automations extension slash commands.
 */

import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, matchesKey, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";
import { resolveAutomationsConfig } from "./config.js";
import { commandSummary, widgetLines } from "./format.js";
import { renderSchedulerSnapshot } from "./format.js";
import type { PiScheduler } from "./pi-scheduler.js";
import { formatScheduleList, listSchedules, removeSchedule, renderInternalSchedulePlan, runSchedule } from "./schedules.js";
import { automationsDoctor, automationsStatus } from "./status.js";
import { formatWorkspaceList, listWorkspaces } from "./workspaces.js";

interface MutableSelectListInternals {
	filteredItems: SelectItem[];
	selectedIndex: number;
}

function selectedItem(selectList: SelectList): SelectItem | undefined {
	// SAFETY: SelectList does not expose its selection; these fields are read-only at this boundary and match the runtime shape.
	const internals = selectList as unknown as MutableSelectListInternals;
	return internals.filteredItems[internals.selectedIndex];
}

function automationsSelectListTheme(theme: Theme): ConstructorParameters<typeof SelectList>[2] {
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
	const workspaces = await listWorkspaces(resolveAutomationsConfig(ctx.cwd));
	const items: SelectItem[] = workspaces.length === 0
		? [{ value: "", label: "No Automations workspaces found", description: "esc close" }]
		: workspaces.map((workspace) => ({
				value: workspace.id,
				label: workspace.id,
				description: `${workspace.hasContext ? "CONTEXT.md" : "missing CONTEXT.md"} · ${workspace.path}${workspace.purpose ? ` · ${workspace.purpose}` : ""}`,
			}));
	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), automationsSelectListTheme(theme));
		selectList.onCancel = () => done();
		selectList.onSelect = (item) => {
			if (item.value) ctx.ui.notify(`Automations workspace: ${item.value}`, "info");
			done();
		};
		return {
			render: (width: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(" Automations Workspaces")) + theme.fg("dim", ` - ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`), 1, 0));
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

async function showScheduleBrowser(ctx: ExtensionCommandContext, scheduler: PiScheduler): Promise<void> {
	const config = resolveAutomationsConfig(ctx.cwd);
	const schedules = await listSchedules(config);
	const items: SelectItem[] = schedules.length === 0
		? [{ value: "", label: "No Automations schedules found", description: "esc close" }]
		: schedules.map((schedule) => ({
				value: schedule.taskId,
				label: `${schedule.enabled ? "on " : "off"} ${schedule.taskId}`,
				description: `${schedule.cronExpr} · ${schedule.workspaceId} · ${schedule.taskName}`,
			}));
	const action = await ctx.ui.custom<{ taskId: string; action: "run" | "remove" } | null>((tui, theme, _kb, done) => {
		const selectList = new SelectList(items, Math.min(Math.max(items.length, 1), 12), automationsSelectListTheme(theme));
		selectList.onCancel = () => done(null);
		selectList.onSelect = (item) => item.value ? done({ taskId: item.value, action: "run" }) : done(null);
		return {
			render: (width: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
				container.addChild(border());
				container.addChild(new Text(theme.fg("accent", theme.bold(" Automations Schedules")) + theme.fg("dim", ` - ${schedules.length} schedule${schedules.length === 1 ? "" : "s"}`), 1, 0));
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
	await showText(ctx, `Automations schedule dry-run: ${action.taskId}`, commandSummary("automations-schedule run", result), result.code === 0 ? "info" : "warning");
}

function doctorLevel(code: number): "info" | "warning" | "error" {
	if (code === 0) return "info";
	if (code === 1) return "warning";
	return "error";
}

export function registerAutomationsCommands(pi: ExtensionAPI, scheduler: PiScheduler): void {
	async function handleAutomationsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
		const trimmed = args.trim();
		const [subcommand, ...rest] = trimmed.split(/\s+/);
		const restArgs = rest.join(" ").trim();
		switch (subcommand) {
			case "status":
			case "": {
				const result = await automationsStatus(resolveAutomationsConfig(ctx.cwd), scheduler.snapshot());
				await showText(ctx, "Automations status", commandSummary("automations-status", result));
				return;
			}
			case "doctor": {
				const result = await automationsDoctor(resolveAutomationsConfig(ctx.cwd), scheduler.snapshot());
				await showText(ctx, `Automations doctor exit=${result.code}`, commandSummary("automations-doctor", result), doctorLevel(result.code));
				return;
			}
			case "workspaces": {
				if (restArgs === "--text") {
					const workspaces = await listWorkspaces(resolveAutomationsConfig(ctx.cwd));
					await showText(ctx, "Automations workspaces", formatWorkspaceList(workspaces));
					return;
				}
				await showWorkspaceBrowser(ctx);
				return;
			}
			case "schedules": {
				const config = resolveAutomationsConfig(ctx.cwd);
				if (restArgs === "--text") {
					const schedules = await listSchedules(config);
					const rendered = await renderInternalSchedulePlan(config);
					await showText(ctx, "Automations schedules", `${formatScheduleList(schedules)}\n\n${renderSchedulerSnapshot(scheduler.snapshot())}\n\n${commandSummary("automations-schedule internal-plan", rendered)}`);
					return;
				}
				await showScheduleBrowser(ctx, scheduler);
				return;
			}
			case "scheduler": {
				await scheduler.reconcile(resolveAutomationsConfig(ctx.cwd));
				await showText(ctx, "Pi scheduler", renderSchedulerSnapshot(scheduler.snapshot()));
				return;
			}
			default:
				ctx.ui.notify("Usage: /automations [status|doctor|workspaces|schedules|scheduler]", "warning");
		}
	}

	pi.registerCommand("automations", {
		description: "Browse or inspect Automations operational state. Usage: /automations [status|doctor|workspaces|schedules|scheduler]",
		handler: handleAutomationsCommand,
	});

	pi.registerCommand("automations-status", {
		description: "Show fast Automations operational status (alias for /automations status)",
		handler: async (_args, ctx) => handleAutomationsCommand("status", ctx),
	});

	pi.registerCommand("automations-doctor", {
		description: "Run Automations diagnostics (alias for /automations doctor)",
		handler: async (_args, ctx) => handleAutomationsCommand("doctor", ctx),
	});

	pi.registerCommand("automations-workspaces", {
		description: "Browse Automations workspaces (alias for /automations workspaces)",
		handler: async (args, ctx) => handleAutomationsCommand(`workspaces ${args}`.trim(), ctx),
	});

	pi.registerCommand("automations-schedules", {
		description: "Browse Automations schedules and internal scheduler state (alias for /automations schedules)",
		handler: async (args, ctx) => handleAutomationsCommand(`schedules ${args}`.trim(), ctx),
	});

	pi.registerCommand("pi-scheduler", {
		description: "Show and reconcile the pi-hosted scheduler (alias for /automations scheduler)",
		handler: async (_args, ctx) => handleAutomationsCommand("scheduler", ctx),
	});
}
