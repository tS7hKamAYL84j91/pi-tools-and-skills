/**
 * Shared pi-panopticon UI formatting helpers.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentRecord, AgentStatus } from "../types.js";
import { agentDisplayName } from "./display-name.js";
import { sortRecords, STATUS_SYMBOL } from "../registry/record-utils.js";

/** Map status → short label shown after the colon in compact segments. */
export const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "active",
	waiting: "idle",
	done: "done",
	blocked: "blocked",
	stalled: "stalled",
	terminated: "dead",
	unknown: "?",
};

/** Build a top/bottom accent border for overlay containers. */
export function accentBorder(theme: Theme): DynamicBorder {
	return new DynamicBorder((s: string) => theme.fg("accent", s));
}

export type ThemeColor = Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0];

/** Map status → theme colour key for the name portion of a segment. */
const STATUS_COLOR: Record<AgentStatus, ThemeColor> = {
	running: "success",
	waiting: "accent",
	done: "dim",
	blocked: "warning",
	stalled: "warning",
	terminated: "error",
	unknown: "muted",
};

/** Build status segments for all agents; self is bold accent. */
export function buildStatusSegments(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
): string[] {
	return sortRecords(records, selfId).map((rec) => {
		const sym = STATUS_SYMBOL[rec.status];
		const label = STATUS_LABEL[rec.status];
		const name = agentDisplayName(rec, records);
		const inbox =
			(rec.pendingMessages ?? 0) > 0
				? theme.fg("warning", `(msg:${rec.pendingMessages})`)
				: "";
		if (rec.id === selfId)
			return `${sym} ${theme.fg("accent", theme.bold(name))}${theme.fg("dim", `:${label}`)}${inbox}`;
		return `${sym} ${theme.fg(STATUS_COLOR[rec.status], name)}${theme.fg("dim", `:${label}`)}${inbox}`;
	});
}

/** Render compact status widget with an explicit hidden-agent indicator. */
export function renderStatusWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const segs = buildStatusSegments(records, selfId, theme);
	const separator = theme.fg("dim", " | ");
	let line = "";
	for (let index = 0; index < segs.length; index++) {
		const segment = segs[index] ?? "";
		const candidate = line ? `${line}${separator}${segment}` : segment;
		if (visibleWidth(candidate) <= availableWidth) {
			line = candidate;
			continue;
		}

		const hiddenCount = segs.length - index;
		const marker = theme.fg("dim", ` ...+${hiddenCount}`);
		const baseWidth = Math.max(0, availableWidth - visibleWidth(marker));
		return [truncateToWidth(`${truncateToWidth(line, baseWidth)}${marker}`, availableWidth)];
	}
	return [truncateToWidth(line, availableWidth)];
}
