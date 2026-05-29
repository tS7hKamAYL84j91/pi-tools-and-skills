/**
 * Agent panopticon overlay and detail view.
 */

import { DynamicBorder, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import {
	Container,
	type Component,
	type Focusable,
	fuzzyFilter,
	Input,
	Text,
	SelectList,
	type SelectItem,
	matchesKey,
} from "@earendil-works/pi-tui";
import { readSessionLog, type SessionEvent } from "../../lib/session-log.js";
import { confirmDestructiveAction, type DestructiveConfirmationView } from "../../lib/tui-confirmation.js";
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

interface MutableSelectListInternals {
	filteredItems: SelectItem[];
	selectedIndex: number;
}

class AgentSelectList extends SelectList {
	private readonly allItems: SelectItem[];

	constructor(
		items: SelectItem[],
		maxVisible: number,
		theme: ConstructorParameters<typeof SelectList>[2],
	) {
		super(items, maxVisible, theme);
		this.allItems = items;
	}

	override setFilter(query: string): void {
		// SelectList exposes setFilter but not a fuzzy matcher hook, so this mirrors
		// the existing Teams picker pattern to update its private filtered state.
		const internals = this as unknown as MutableSelectListInternals;
		const trimmed = query.trim();
		internals.filteredItems = trimmed.length === 0
			? this.allItems
			: fuzzyFilter(
					this.allItems,
					trimmed,
					(item) => `${item.label} ${item.description ?? ""} ${item.value}`,
				);
		internals.selectedIndex = 0;
	}
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

interface AgentListComponentOptions extends Omit<RenderAgentListOverlayArgs, "width"> {
	searchActive?: boolean;
	query?: string;
}

function agentSelectListTheme(theme: Theme): ConstructorParameters<typeof SelectList>[2] {
	return {
		// SelectList hardcodes a Unicode arrow; normalize it to the shared
		// ASCII-safe selected-row marker used by Teams and Kanban.
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t.replace(/^→/, ">")),
		description: (t: string) => theme.fg("muted", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};
}

function createAgentListComponent(args: AgentListComponentOptions): Component & Focusable & { selectList: AgentSelectList } {
	const sortedRecords = sortAgentOverlayRecords(args.records, args.selfId);
	const selectList = new AgentSelectList(
		agentSelectItems(sortedRecords, args.selfId),
		Math.min(sortedRecords.length, 12),
		agentSelectListTheme(args.theme),
	);
	const searchInput = new Input();
	let searchActive = args.searchActive === true;
	let focused = false;
	if (args.query) {
		searchInput.setValue(args.query);
		selectList.setFilter(args.query);
	}

	const component: Component & Focusable & { selectList: AgentSelectList } = {
		selectList,
		get focused(): boolean {
			return focused;
		},
		set focused(value: boolean) {
			focused = value;
			searchInput.focused = value && searchActive;
		},
		render: (width: number) => {
			const container = new Container();
			const border = () => new DynamicBorder((s: string) => args.theme.fg("accent", s));
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
			if (searchActive) {
				container.addChild(searchInput);
			}
			container.addChild(selectList);
			container.addChild(new Text(args.theme.fg("dim", searchActive
				? "  type to filter · ↑/↓ navigate · enter detail · esc clear"
				: "  ↑/↓ navigate · enter detail · / filter · esc close · unread first"), 1, 0));
			container.addChild(border());
			return container.render(width);
		},
		invalidate: () => {
			searchInput.invalidate();
			selectList.invalidate();
		},
		handleInput: (data: string) => {
			if (searchActive) {
				if (matchesKey(data, "escape")) {
					searchActive = false;
					searchInput.setValue("");
					searchInput.focused = false;
					selectList.setFilter("");
					return;
				}
				if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "return") || matchesKey(data, "enter")) {
					selectList.handleInput(data);
					return;
				}
				searchInput.handleInput(data);
				selectList.setFilter(searchInput.getValue());
				return;
			}
			if (data === "/") {
				searchActive = true;
				searchInput.setValue("");
				searchInput.focused = focused;
				selectList.setFilter("");
				return;
			}
			selectList.handleInput(data);
		},
	};
	return component;
}

export function renderAgentListOverlay(args: RenderAgentListOverlayArgs & { searchActive?: boolean; query?: string }): string[] {
	return createAgentListComponent(args).render(args.width);
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

/** @internal Return true for detail-view keys that navigate back to the agent list. */
export function isAgentDetailBackInput(data: string): boolean {
	return matchesKey(data, "backspace") || matchesKey(data, "left");
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

	add(`\n  ${args.theme.fg("dim", ["backspace/← list", "esc close", ...(!isSelf ? ["c direct message", "m send message", "s stop", "k kill"] : [])].join(" · "))}`);
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

	while (true) {
		const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const component = createAgentListComponent({
				records,
				selfId: deps.selfId,
				theme,
			});
			component.selectList.onSelect = (item) => done(item.value);
			component.selectList.onCancel = () => done(null);

			return {
				get focused(): boolean {
					return component.focused;
				},
				set focused(value: boolean) {
					component.focused = value;
				},
				render: (w: number) => component.render(w),
				invalidate: () => component.invalidate(),
				handleInput: (data: string) => {
					component.handleInput?.(data);
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
		const detailAction = await showAgentDetail(ctx, selected, deps);
		if (detailAction !== "back") return;
	}
}

/** @internal Build the standardized stop/kill confirmation view. */
export function agentStopConfirmationView(record: AgentRecord, force: boolean): DestructiveConfirmationView {
	return {
		title: force ? "Confirm KILL agent" : "Confirm stop agent",
		subject: `${record.name} (pid ${record.pid})`,
		details: [force ? "Sends SIGKILL immediately." : "Requests graceful SIGTERM."],
		severity: force ? "error" : "warning",
	};
}

async function confirmAgentStop(
	ctx: ExtensionContext,
	record: AgentRecord,
	force: boolean,
): Promise<boolean> {
	return confirmDestructiveAction(ctx, agentStopConfirmationView(record, force));
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

type AgentDetailAction = "back" | "close";

async function showAgentDetail(
	ctx: ExtensionContext,
	agentName: string,
	deps: AgentOverlayDeps,
): Promise<AgentDetailAction> {
	const self = deps.registry.getRecord();
	const records = visibleRecords(self, deps.registry.readAllPeers());
	const rec = findAgentByDisplayName(records, agentName);
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return "close";
	}

	const isSelf = rec.id === deps.selfId;
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];
	let action: "back" | "message" | "compose" | "stop" | "kill" | undefined;

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
				if (isAgentDetailBackInput(data)) {
					action = "back";
					done();
				} else if (matchesKey(data, "escape")) {
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

	if (action === "back") {
		return "back";
	}
	if (action === "compose") {
		ctx.ui.setEditorText(`/send ${agentDisplayName(rec, records)} `);
	} else if (action === "message") {
		await openAgentMessageOverlay(ctx, agentName, rec, deps);
	} else if (action === "stop" || action === "kill") {
		await confirmAndStopAgent(ctx, rec, deps, action === "kill");
	}
	return "close";
}
