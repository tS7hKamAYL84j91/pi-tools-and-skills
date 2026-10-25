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
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { formatAge, sortRecords, STATUS_SYMBOL } from "../registry/record-utils.js";
import type { AgentRecord } from "../types.js";
import { agentDisplayName } from "./display-name.js";
import { filterAgentList } from "../registry/visibility.js";
import { accentBorder, renderStatusWidget } from "./ui-format.js";
import type { AgentOverlayDeps } from "./agent-overlay-types.js";

/**
 * Fixed non-list lines in the agent list overlay: top/bottom borders, title,
 * status block (`Text` with a blank padding line either side), separator, hint,
 * plus one line reserved for the search input, and a list budget derived at
 * open time so toggling search and SelectList's scroll-info row cannot push the
 * overlay past pi-tui's maxHeight clip (which drops bottom lines silently).
 * Short terminals drop the status block (`compact`, -3 lines); below
 * AGENT_LIST_MIN_ROWS the overlay cannot fit at all and is skipped.
 */
const AGENT_LIST_CHROME_LINES = 9;
const AGENT_LIST_COMPACT_CHROME_LINES = 6;
/** Below this many terminal rows the status block is dropped to keep a list row visible. */
const AGENT_LIST_COMPACT_BELOW_ROWS = 14;
/** Below this many terminal rows even compact chrome cannot fit one list row. */
export const AGENT_LIST_MIN_ROWS = 12;
const AGENT_LIST_MAX_VISIBLE_CAP = 12;

/** @internal Max list rows so the overlay fits; selection never scrolls out of view.
 *  Unknown rows (e.g. test fakes, non-TUI hosts) keep the legacy full-list cap. */
export function agentListMaxVisible(
	rows: number | undefined,
	agentCount: number,
	compact = false,
): number {
	if (rows === undefined) return Math.min(agentCount, AGENT_LIST_MAX_VISIBLE_CAP);
	// Mirror pi-tui's overlay math for { maxHeight: "80%", margin: 2 } (floor + clamp).
	const maxHeightLines = Math.max(1, Math.min(Math.floor(rows * 0.8), Math.max(1, rows - 4)));
	const chrome = compact ? AGENT_LIST_COMPACT_CHROME_LINES : AGENT_LIST_CHROME_LINES;
	const listBudget = Math.max(1, maxHeightLines - chrome);
	if (agentCount <= listBudget) return Math.min(agentCount, AGENT_LIST_MAX_VISIBLE_CAP);
	// Clipped list: SelectList appends its scroll-info row, so reserve one line.
	return Math.max(1, Math.min(AGENT_LIST_MAX_VISIBLE_CAP, listBudget - 1));
}

/** @internal True when the terminal is too short for the full chrome. */
export function agentListCompact(rows: number | undefined): boolean {
	return rows !== undefined && rows < AGENT_LIST_COMPACT_BELOW_ROWS;
}

/** @internal True when the terminal cannot fit the overlay at all (skip it). */
export function agentListTooShort(rows: number | undefined): boolean {
	return rows !== undefined && rows < AGENT_LIST_MIN_ROWS;
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
	// SAFETY: SelectList exposes setFilter but not a fuzzy matcher hook, so this
	// mirrors the existing Teams picker pattern to update its private filtered
	// state; MutableSelectListInternals is the exact runtime shape of `this`.
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

export interface AgentListOverlayArgs {
	records: AgentRecord[];
	selfId: string;
	theme: Theme;
	width: number;
	/** Optional row cap; the live overlay passes agentListMaxVisible(terminalRows, count). */
	maxVisible?: number;
	/** Drop the status block on short terminals so at least one list row fits. */
	compact?: boolean;
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

/** Compact, width-appropriate key hints; chosen so they never need wrapping. */
function hintFor(width: number, searchActive: boolean): string {
	if (searchActive) {
		if (width >= 60) return "  type to filter · ↑/↓ navigate · enter detail · esc clear";
		if (width >= 40) return "  type filter · ↑/↓ · enter · esc clear";
		return "  / filter · esc";
	}
	if (width >= 70) return "  ↑/↓ navigate · enter detail · / filter · esc close · unread first";
	if (width >= 60) return "  ↑/↓ · enter detail · / filter · esc close · unread first";
	if (width >= 44) return "  ↑/↓ · enter · / filter · esc close";
	return "  ↑/↓ · enter · esc";
}

interface AgentListComponentOptions extends Omit<AgentListOverlayArgs, "width"> {
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
		args.maxVisible ?? Math.min(sortedRecords.length, AGENT_LIST_MAX_VISIBLE_CAP),
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
			// Every chrome row is truncated to one line. A wrapping Text would make
			// the overlay height depend on terminal width, so pi-tui's maxHeight clip
			// would silently drop bottom list rows and the selection could scroll out
			// of view. Single-line chrome keeps AGENT_LIST_CHROME_LINES exact.
			const single = (text: string) =>
				new Text(truncateToWidth(text, Math.max(1, width - 2)), 1, 0);
			const container = new Container();
			container.addChild(accentBorder(args.theme));
			container.addChild(
				single(
					args.theme.fg("accent", args.theme.bold(" Agent Hub")) +
						args.theme.fg("dim", ` - ${args.records.length} agent${args.records.length !== 1 ? "s" : ""}`),
				),
			);
			// Status block keeps its one blank padding line either side; short
			// terminals drop it so the list itself still fits the maxHeight clip.
			if (args.compact !== true) {
				const statusLine = renderStatusWidget(args.records, args.selfId, args.theme, Math.max(10, width - 2)).join("");
				container.addChild(new Text(statusLine, 1, 1));
			}
			container.addChild(single(args.theme.fg("dim", " ─────────────────────────────────────────────────────")));
			if (searchActive) {
				container.addChild(searchInput);
			}
			container.addChild(selectList);
			container.addChild(single(args.theme.fg("dim", hintFor(width, searchActive))));
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

export function renderAgentListOverlay(args: AgentListOverlayArgs & { searchActive?: boolean; query?: string }): string[] {
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
		const rows = (tui as { terminal?: { rows?: number } }).terminal?.rows;
		// Too short for even compact chrome: say so instead of rendering an
		// overlay whose clipped bottom row could hide the selection.
		if (agentListTooShort(rows)) {
			ctx.ui.notify(
				`Terminal too short for the agent list (needs ${AGENT_LIST_MIN_ROWS}+ rows)`,
				"warning",
			);
			innerDone(null);
			return { render: () => [], invalidate: () => {}, handleInput: () => {} };
		}
		const compact = agentListCompact(rows);
		const component = createAgentListComponent({
			records,
			selfId: deps.selfId,
			theme,
			compact,
			maxVisible: agentListMaxVisible(rows, records.length, compact),
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
	}).then((value) => done(value ?? null));
}
