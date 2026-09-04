/** Native TUI inspection component rendering and navigation for pi-event-loop (SPEC §16; TODO P13). */

import { DynamicBorder, type ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { formatScrollCue } from "../../lib/tui-overflow.js";
import type { EventLoopStatus } from "./status.js";
import type { LoopEventData, TodoItem } from "./types.js";
const DEFAULT_MAX_VISIBLE_ROWS = 10;

export interface EventLoopTheme {
	readonly fg: (color: ThemeColor, text: string) => string;
	readonly bold?: (text: string) => string;
}

interface EventLoopInspectorDeps {
	readonly status: EventLoopStatus;
	readonly history: readonly LoopEventData[];
	readonly onDone: () => void;
	readonly theme: EventLoopTheme;
	readonly tui?: Pick<TUI, "requestRender">;
	readonly maxVisibleRows?: number;
}

/** Native, width-bounded inspection component for views and event history. */
export class EventLoopInspector implements Component {
	private activeTab = 0; // 0 = Status, 1 = Views, 2 = History
	private selectedIndex = 0;
	private scrollOffset = 0;
	private expanded = false;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly topBorder: DynamicBorder;
	private readonly bottomBorder: DynamicBorder;

	constructor(private readonly deps: EventLoopInspectorDeps) {
		this.topBorder = new DynamicBorder((s: string) => deps.theme.fg("accent", s));
		this.bottomBorder = new DynamicBorder((s: string) => deps.theme.fg("accent", s));
	}

	render(width: number): string[] {
		if (this.cachedLines !== undefined && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		const theme = this.deps.theme;

		for (const borderLine of this.topBorder.render(width)) {
			lines.push(truncateToWidth(borderLine, width));
		}

		const title = theme.bold ? theme.bold("Event Loop Inspector") : "Event Loop Inspector";
		const tabs = [
			this.activeTab === 0 ? theme.fg("accent", "[1] Status") : theme.fg("muted", " 1  Status"),
			this.activeTab === 1 ? theme.fg("accent", "[2] Views") : theme.fg("muted", " 2  Views"),
			this.activeTab === 2 ? theme.fg("accent", "[3] History") : theme.fg("muted", " 3  History"),
		].join("  ");

		lines.push(truncateToWidth(` ${theme.fg("accent", title)}  ${tabs}`, width));
		lines.push(truncateToWidth("", width));

		for (const line of this.renderActiveTab()) {
			lines.push(truncateToWidth(line, width));
		}

		lines.push(truncateToWidth("", width));
		lines.push(truncateToWidth(theme.fg("dim", " ↑↓ scroll • enter toggle detail • 1/2/3 tab • esc close"), width));

		for (const borderLine of this.bottomBorder.render(width)) {
			lines.push(truncateToWidth(borderLine, width));
		}

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q" || matchesKey(data, Key.ctrl("c"))) {
			this.deps.onDone();
			return;
		}

		if (data === "1" || data === "2" || data === "3") {
			this.switchTab(Number.parseInt(data, 10) - 1);
			return;
		}
		if (matchesKey(data, Key.tab)) {
			this.switchTab((this.activeTab + 1) % 3);
			return;
		}

		const total = this.totalItemsForActiveTab();
		if (matchesKey(data, Key.up) && this.selectedIndex > 0) {
			this.selectedIndex--;
			if (this.selectedIndex < this.scrollOffset) {
				this.scrollOffset = this.selectedIndex;
			}
			this.refresh();
			return;
		}

		const maxVisible = this.deps.maxVisibleRows ?? DEFAULT_MAX_VISIBLE_ROWS;
		if (matchesKey(data, Key.down) && this.selectedIndex < total - 1) {
			this.selectedIndex++;
			if (this.selectedIndex >= this.scrollOffset + maxVisible) {
				this.scrollOffset = this.selectedIndex - maxVisible + 1;
			}
			this.refresh();
			return;
		}

		if (matchesKey(data, Key.enter) || data === "\r") {
			this.expanded = !this.expanded;
			this.invalidate();
			this.deps.tui?.requestRender();
		}
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private refresh(): void {
		this.expanded = false;
		this.invalidate();
		this.deps.tui?.requestRender();
	}

	private switchTab(newTab: number): void {
		this.activeTab = newTab;
		this.selectedIndex = 0;
		this.scrollOffset = 0;
		this.refresh();
	}

	private renderActiveTab(): string[] {
		if (this.activeTab === 0) return this.renderStatusTab();
		if (this.activeTab === 1) return this.renderViewsTab();
		return this.renderHistoryTab();
	}

	private renderStatusTab(): string[] {
		const { status, theme } = this.deps;
		const stateText = status.paused
			? theme.fg("warning", `paused (${status.pauseReason ?? "manual"})`)
			: theme.fg("success", "running");
		const lines = [
			` Profile:   ${theme.fg("accent", status.profileName)}`,
			` State:     ${stateText}`,
			` Busy:      ${status.busy ? "yes" : "no"}`,
			` Turns:     ${status.consecutiveAutomatedTurns} automated`,
			` Queued:    ${status.pendingCommandCount} pending`,
			` Events:    ${status.eventCount} total`,
		];
		if (status.activeCommand !== undefined) {
			lines.push("");
			lines.push(` Active Command:   ${status.activeCommand.type}`);
			lines.push(` Work Item ID:     ${status.activeCommand.workItemId}`);
			lines.push(` Expected Events:  ${status.activeCommand.expectedEvents.join(", ")}`);
		}
		return lines;
	}

	private allViewRows(): TodoItem[] {
		return Object.values(this.deps.status.viewRows).flat();
	}

	private totalItemsForActiveTab(): number {
		return this.activeTab === 1 ? this.allViewRows().length : this.activeTab === 2 ? this.deps.history.length : 0;
	}

	private renderViewsTab(): string[] {
		const rows = this.allViewRows();
		const { theme, maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS } = this.deps;
		if (rows.length === 0) return [theme.fg("dim", " (no view rows found)")];

		const visible = rows.slice(this.scrollOffset, this.scrollOffset + maxVisibleRows);
		const lines: string[] = [];
		for (let i = 0; i < visible.length; i++) {
			const row = visible[i];
			if (!row) continue;
			const isSel = this.scrollOffset + i === this.selectedIndex;
			const pfx = isSel ? theme.fg("accent", "> ") : "  ";
			const col = row.status === "completed" ? "muted" : row.status === "stalled" ? "error" : "accent";
			lines.push(`${pfx}[${row.viewId}] ${row.workItemId} [${theme.fg(col, row.status)}] key=${row.key}`);

			if (isSel && this.expanded) {
				lines.push(`    ${theme.fg("dim", "openedBy:")} ${row.openedByEventId}`);
				lines.push(`    ${theme.fg("dim", "payload:")} ${JSON.stringify(row.sourcePayload)}`);
				if (row.commandId) lines.push(`    ${theme.fg("dim", "commandId:")} ${row.commandId}`);
				if (row.completedByEventId) lines.push(`    ${theme.fg("dim", "completedBy:")} ${row.completedByEventId}`);
			}
		}

		const cue = formatScrollCue({
			visibleCount: visible.length,
			totalCount: rows.length,
			canScrollUp: this.scrollOffset > 0,
			canScrollDown: this.scrollOffset + maxVisibleRows < rows.length,
		});
		if (cue) lines.push(theme.fg("dim", ` ${cue}`));
		return lines;
	}

	private renderHistoryTab(): string[] {
		const { history, theme, maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS } = this.deps;
		if (history.length === 0) return [theme.fg("dim", " (no events in session history)")];

		const visible = history.slice(this.scrollOffset, this.scrollOffset + maxVisibleRows);
		const lines: string[] = [];
		for (let i = 0; i < visible.length; i++) {
			const evt = visible[i];
			if (!evt) continue;
			const isSel = this.scrollOffset + i === this.selectedIndex;
			const pfx = isSel ? theme.fg("accent", "> ") : "  ";
			lines.push(`${pfx}${evt.occurredAt} [${evt.source}] ${theme.fg("accent", evt.type)} (${evt.eventId})`);

			if (isSel && this.expanded) {
				lines.push(`    ${theme.fg("dim", "payload:")} ${JSON.stringify(evt.payload)}`);
				if (evt.commandId) lines.push(`    ${theme.fg("dim", "commandId:")} ${evt.commandId}`);
				if (evt.workItemId) lines.push(`    ${theme.fg("dim", "workItemId:")} ${evt.workItemId}`);
				if (evt.correlationId) lines.push(`    ${theme.fg("dim", "correlationId:")} ${evt.correlationId}`);
			}
		}

		const cue = formatScrollCue({
			visibleCount: visible.length,
			totalCount: history.length,
			canScrollUp: this.scrollOffset > 0,
			canScrollDown: this.scrollOffset + maxVisibleRows < history.length,
		});
		if (cue) lines.push(theme.fg("dim", ` ${cue}`));
		return lines;
	}
}
