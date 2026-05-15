/**
 * Agent panopticon overlay and detail view.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	Text,
	SelectList,
	type SelectItem,
	matchesKey,
} from "@earendil-works/pi-tui";
import { readSessionLog, type SessionEvent } from "../../lib/session-log.js";
import { openAgentMessageOverlay } from "./agent-message-overlay.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";
import { formatAge, sortRecords, STATUS_SYMBOL } from "./registry.js";
import type { AgentRecord } from "./types.js";
import { agentDisplayName, findAgentByDisplayName } from "./display-name.js";
import { filterAgentList, visibleRecords } from "./visibility.js";
import {
	buildStatusSegments,
	type ThemeColor,
} from "./ui-format.js";

function agentSelectItems(records: readonly AgentRecord[], selfId: string): SelectItem[] {
	return records.map((rec) => {
		const displayName = agentDisplayName(rec, records);
		return {
			value: displayName,
			label: `${STATUS_SYMBOL[rec.status]} ${displayName}${rec.id === selfId ? " (you)" : ""}`,
			description: `${rec.status} │ ${rec.model || "?"} │ up ${formatAge(rec.startedAt)}${rec.task ? ` │ ${rec.task.slice(0, 50)}` : ""}`,
		};
	});
}

interface RenderAgentListOverlayArgs {
	records: AgentRecord[];
	selfId: string;
	theme: Theme;
	width: number;
}

/** @internal Sort agent overlays with self first, then unread-message urgency. */
export function sortAgentOverlayRecords(
	records: readonly AgentRecord[],
	selfId: string,
): AgentRecord[] {
	return sortRecords([...records], selfId).sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return (b.pendingMessages ?? 0) - (a.pendingMessages ?? 0);
	});
}

function createAgentListView(args: Omit<RenderAgentListOverlayArgs, "width">): { container: Container; selectList: SelectList } {
	const container = new Container();
	const sortedRecords = sortAgentOverlayRecords(args.records, args.selfId);
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	const selectList = new SelectList(agentSelectItems(sortedRecords, args.selfId), Math.min(sortedRecords.length, 12), {
		// SelectList hardcodes a Unicode arrow; normalize it to the shared
		// ASCII-safe selected-row marker used by Teams and Kanban.
		selectedPrefix: (t: string) => args.theme.fg("accent", t),
		selectedText: (t: string) => args.theme.fg("accent", t.replace(/^→/, ">")),
		description: (t: string) => args.theme.fg("muted", t),
		scrollInfo: (t: string) => args.theme.fg("dim", t),
		noMatch: (t: string) => args.theme.fg("warning", t),
	});

	container.addChild(border());
	container.addChild(
		new Text(
			args.theme.fg("accent", args.theme.bold(" Agent Panopticon")) +
				args.theme.fg("dim", ` - ${args.records.length} agent${args.records.length !== 1 ? "s" : ""}`),
			1,
			0,
		),
	);
	container.addChild(new Text(` ${buildStatusSegments(args.records, args.selfId, args.theme).join(args.theme.fg("dim", " | "))}`, 1, 1));
	container.addChild(new Text(args.theme.fg("dim", " ─────────────────────────────────────────────────────"), 1, 0));
	container.addChild(selectList);
	container.addChild(new Text(args.theme.fg("dim", "  ↑/↓ navigate · enter detail · esc close · unread first"), 1, 0));
	container.addChild(border());
	return { container, selectList };
}

export function renderAgentListOverlay(args: RenderAgentListOverlayArgs): string[] {
	return createAgentListView(args).container.render(args.width);
}

interface RenderAgentDetailOverlayArgs {
	record: AgentRecord;
	selfId: string;
	sessionEvents: SessionEvent[];
	theme: Theme;
	width: number;
}

function agentDetailRows(record: AgentRecord): [string, string][] {
	const rows: [string, string][] = [
		["Model", record.model || "unknown"],
		["CWD", record.cwd],
		["PID", String(record.pid)],
		["Messages", `msg:${record.pendingMessages ?? 0}`],
		["Uptime", formatAge(record.startedAt)],
	];
	if (record.task) {
		rows.push(["Task", record.task.slice(0, 60)]);
	}
	return rows;
}

function activityColor(event: string): ThemeColor {
	if (event.includes("error")) {
		return "error";
	}
	if (event.includes("start")) {
		return "success";
	}
	if (event.includes("end")) {
		return "warning";
	}
	return "dim";
}

function activityExtra(entry: SessionEvent): string {
	return Object.entries(entry)
		.filter(([key]) => key !== "ts" && key !== "event")
		.map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
		.join(" ");
}

interface ActivityWindow {
	visibleEvents: SessionEvent[];
	hiddenCount: number;
}

function activityWindow(events: readonly SessionEvent[]): ActivityWindow {
	const visibleEvents = events.slice(-15);
	return { visibleEvents, hiddenCount: events.length - visibleEvents.length };
}

export function renderAgentDetailOverlay(args: RenderAgentDetailOverlayArgs): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	const add = (s: string) => container.addChild(new Text(s, 1, 0));
	const row = (label: string, value: string) =>
		add(`  ${args.theme.fg("dim", label.padEnd(12))} ${args.theme.fg("text", value)}`);
	const isSelf = args.record.id === args.selfId;

	container.addChild(border());
	add(`  ${STATUS_SYMBOL[args.record.status]} ${args.theme.fg("accent", args.theme.bold(args.record.name))}${isSelf ? args.theme.fg("dim", " (you)") : ""}  ${args.theme.fg("muted", args.record.status)}`);

	for (const [label, value] of agentDetailRows(args.record)) {
		row(label, value);
	}

	add(`\n  ${args.theme.fg("accent", args.theme.bold("Recent Activity"))} ${args.theme.fg("dim", `(${args.sessionEvents.length} events)`)}`);
	if (args.sessionEvents.length === 0) {
		add(`  ${args.theme.fg("dim", "(no activity recorded)")}`);
	} else {
		const { visibleEvents, hiddenCount } = activityWindow(args.sessionEvents);
		if (hiddenCount > 0) {
			add(`  ${args.theme.fg("dim", `... ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"} omitted`)}`);
		}
		for (const entry of visibleEvents) {
			const ts = new Date(entry.ts).toISOString().slice(11, 19);
			const event = String(entry.event ?? "?");
			const extra = activityExtra(entry);
			add(`  ${args.theme.fg("dim", ts)} ${args.theme.fg(activityColor(event), event)}${extra ? args.theme.fg("muted", ` ${extra}`) : ""}`);
		}
	}

	add(`\n  ${args.theme.fg("dim", ["esc close", ...(!isSelf ? ["c direct message", "m send message", "s stop", "k kill"] : [])].join(" · "))}`);
	container.addChild(border());
	return container.render(args.width);
}

export async function openAgentOverlay(
	ctx: ExtensionContext,
	deps: AgentOverlayDeps,
): Promise<void> {
	const self = deps.registry.getRecord();
	const records = filterAgentList(self, deps.registry.readAllPeers(), deps.listMode.get(self));
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		return;
	}

	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const { container, selectList } = createAgentListView({
			records,
			selfId: deps.selfId,
			theme,
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				selectList.handleInput(data);
				tui.requestRender();
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

	if (!selected) return;
	await showAgentDetail(ctx, selected, deps);
}

async function confirmAgentStop(
	ctx: ExtensionContext,
	record: AgentRecord,
	force: boolean,
): Promise<boolean> {
	return ctx.ui.custom<boolean>((_tui, theme, _kb, done) => {
		const action = force ? "KILL" : "stop";
		return {
			render: (w: number) => {
				const container = new Container();
				const border = () => new DynamicBorder((s: string) => theme.fg(force ? "error" : "warning", s));
				container.addChild(border());
				container.addChild(new Text(`  ${theme.fg(force ? "error" : "warning", theme.bold(`Confirm ${action} agent`))}`, 1, 0));
				container.addChild(new Text(`  ${record.name} (pid ${record.pid})`, 1, 0));
				container.addChild(new Text(`  ${theme.fg("dim", "y confirm · esc/n cancel")}`, 1, 0));
				container.addChild(border());
				return container.render(w);
			},
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (data === "y" || data === "Y") {
					done(true);
				} else if (data === "n" || data === "N" || matchesKey(data, "escape")) {
					done(false);
				}
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			width: "50%",
			minWidth: 40,
			maxHeight: "40%",
			anchor: "center",
			margin: 2,
		},
	});
}

async function confirmAndStopAgent(
	ctx: ExtensionContext,
	record: AgentRecord,
	deps: AgentOverlayDeps,
	force: boolean,
): Promise<void> {
	if (!(await confirmAgentStop(ctx, record, force))) return;
	const result = await deps.stopAgent(record, force);
	if (result.accepted) {
		ctx.ui.notify(`Sent ${result.method ?? (force ? "SIGKILL" : "SIGTERM")} to ${record.name} (pid ${result.pid ?? record.pid})`, "info");
	} else {
		ctx.ui.notify(result.error ?? `Failed to stop ${record.name}`, "error");
	}
}

async function showAgentDetail(
	ctx: ExtensionContext,
	agentName: string,
	deps: AgentOverlayDeps,
): Promise<void> {
	const self = deps.registry.getRecord();
	const records = visibleRecords(self, deps.registry.readAllPeers());
	const rec = findAgentByDisplayName(records, agentName);
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === deps.selfId;
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];
	let action: "message" | "compose" | "stop" | "kill" | undefined;

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		return {
			render: (w: number) => renderAgentDetailOverlay({
				record: rec,
				selfId: deps.selfId,
				sessionEvents,
				theme,
				width: w,
			}),
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "c" || data === "C")) {
					action = "message";
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					action = "compose";
					done();
				} else if (!isSelf && (data === "s" || data === "S")) {
					action = "stop";
					done();
				} else if (!isSelf && (data === "k" || data === "K")) {
					action = "kill";
					done();
				}
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

	if (action === "compose") {
		ctx.ui.setEditorText(`/send ${agentDisplayName(rec, records)} `);
	} else if (action === "message") {
		await openAgentMessageOverlay(ctx, agentName, rec, deps);
	} else if (action === "stop" || action === "kill") {
		await confirmAndStopAgent(ctx, rec, deps, action === "kill");
	}
}
