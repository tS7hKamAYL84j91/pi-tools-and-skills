/**
 * Agent list overlay component.
 */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
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
import { formatAge, sortRecords, STATUS_SYMBOL } from "../registry/registry.js";
import type { AgentRecord } from "../types.js";
import { agentDisplayName } from "./display-name.js";
import { filterAgentList } from "../registry/visibility.js";
import { accentBorder, buildStatusSegments } from "./ui-format.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";

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

interface AgentListComponentOptions extends Omit<RenderAgentListOverlayArgs, "width"> {
	searchActive?: boolean;
	query?: string;
}

function agentSelectListTheme(theme: Theme): ConstructorParameters<typeof SelectList>[2] {
	return {
		// SelectList hardcodes a Unicode arrow; normalize it to the shared
		// ASCII-safe selected-row marker used by Teams and Kanban.
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t.replace(/^→\s?/, "> ")),
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
			container.addChild(accentBorder(args.theme));
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
			container.addChild(accentBorder(args.theme));
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

export async function openAgentListOverlay(
	ctx: ExtensionContext,
	deps: AgentOverlayDeps,
	done: (selected: string | null) => void,
): Promise<void> {
	const self = deps.registry.getRecord();
	const records = filterAgentList(self, deps.registry.readAllPeers(), deps.listMode.get(self));
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		done(null);
		return;
	}

	await ctx.ui.custom<string | null>((tui, theme, _kb, innerDone) => {
		const component = createAgentListComponent({
			records,
			selfId: deps.selfId,
			theme,
		});
		component.selectList.onSelect = (item) => innerDone(item.value);
		component.selectList.onCancel = () => innerDone(null);

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
	}).then((value) => done(value));
}
