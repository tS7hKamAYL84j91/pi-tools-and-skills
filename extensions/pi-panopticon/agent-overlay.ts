/**
 * Agent panopticon overlay and detail view.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Text,
	SelectList,
	type SelectItem,
	matchesKey,
} from "@mariozechner/pi-tui";
import { readSessionLog, type SessionEvent } from "../../lib/session-log.js";
import type { AgentListModeStore } from "./list-mode.js";
import { formatAge, sortRecords, STATUS_SYMBOL } from "./registry.js";
import type { AgentRecord, Registry } from "./types.js";
import { agentDisplayName, findAgentByDisplayName } from "./display-name.js";
import { filterAgentList, visibleRecords } from "./visibility.js";
import {
	buildStatusSegments,
	type ThemeColor,
} from "./ui-format.js";

function agentSelectItems(records: readonly AgentRecord[], selfId: string): SelectItem[] {
	return records.map((rec) => ({
		value: agentDisplayName(rec, records),
		label: `${STATUS_SYMBOL[rec.status]} ${agentDisplayName(rec, records)}${rec.id === selfId ? " (you)" : ""}`,
		description: `${rec.status} │ ${rec.model || "?"} │ up ${formatAge(rec.startedAt)}${rec.task ? ` │ ${rec.task.slice(0, 50)}` : ""}`,
	}));
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

export function renderAgentDetailOverlay(args: RenderAgentDetailOverlayArgs): string[] {
	const container = new Container();
	const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
	const add = (s: string) => container.addChild(new Text(s, 1, 0));
	const row = (label: string, value: string) =>
		add(`  ${args.theme.fg("dim", label.padEnd(12))} ${args.theme.fg("text", value)}`);
	const isSelf = args.record.id === args.selfId;

	container.addChild(border());
	add(`  ${STATUS_SYMBOL[args.record.status]} ${args.theme.fg("accent", args.theme.bold(args.record.name))}${isSelf ? args.theme.fg("dim", " (you)") : ""}  ${args.theme.fg("muted", args.record.status)}`);

	const pending = args.record.pendingMessages ?? 0;
	const details: [string, string][] = [
		["Model", args.record.model || "unknown"],
		["CWD", args.record.cwd],
		["PID", String(args.record.pid)],
		["Messages", `msg:${pending}`],
		["Uptime", formatAge(args.record.startedAt)],
	];
	if (args.record.task) details.push(["Task", args.record.task.slice(0, 60)]);
	for (const [label, value] of details) row(label, value);

	add(`\n  ${args.theme.fg("accent", args.theme.bold("Recent Activity"))} ${args.theme.fg("dim", `(${args.sessionEvents.length} events)`)}`);
	if (args.sessionEvents.length === 0) {
		add(`  ${args.theme.fg("dim", "(no activity recorded)")}`);
	} else {
		const visibleEvents = args.sessionEvents.slice(-15);
		const hiddenCount = args.sessionEvents.length - visibleEvents.length;
		if (hiddenCount > 0) {
			add(`  ${args.theme.fg("dim", `... ${hiddenCount} earlier event${hiddenCount === 1 ? "" : "s"} omitted`)}`);
		}
		for (const entry of visibleEvents) {
			const ts = new Date(entry.ts).toISOString().slice(11, 19);
			const event = String(entry.event ?? "?");
			const col: ThemeColor = event.includes("error")
				? "error"
				: event.includes("start")
					? "success"
					: event.includes("end")
						? "warning"
						: "dim";
			const extra = Object.entries(entry)
				.filter(([k]) => k !== "ts" && k !== "event")
				.map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
				.join(" ");
			add(`  ${args.theme.fg("dim", ts)} ${args.theme.fg(col, event)}${extra ? args.theme.fg("muted", ` ${extra}`) : ""}`);
		}
	}

	add(`\n  ${args.theme.fg("dim", ["esc close", ...(!isSelf ? ["m send message"] : [])].join(" · "))}`);
	container.addChild(border());
	return container.render(args.width);
}

export async function openAgentOverlay(
	ctx: ExtensionContext,
	selfId: string,
	registry: Registry,
	listMode: AgentListModeStore,
): Promise<void> {
	const self = registry.getRecord();
	const records = filterAgentList(self, registry.readAllPeers(), listMode.get(self));
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		return;
	}

	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const { container, selectList } = createAgentListView({
			records,
			selfId,
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
	await showAgentDetail(ctx, selfId, selected, registry);
}

async function showAgentDetail(
	ctx: ExtensionContext,
	selfId: string,
	agentName: string,
	registry: Registry,
): Promise<void> {
	const self = registry.getRecord();
	const records = visibleRecords(self, registry.readAllPeers());
	const rec = findAgentByDisplayName(records, agentName);
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === selfId;
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		return {
			render: (w: number) => renderAgentDetailOverlay({
				record: rec,
				selfId,
				sessionEvents,
				theme,
				width: w,
			}),
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					done();
					ctx.ui.setEditorText(`/send ${agentDisplayName(rec, records)} `);
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
}
