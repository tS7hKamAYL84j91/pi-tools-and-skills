/**
 * Shared pi-panopticon UI formatting helpers.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth } from "@mariozechner/pi-tui";
import type { AgentRecord, AgentStatus } from "./types.js";
import { sortRecords, STATUS_SYMBOL } from "./registry.js";

/** Map status → short label shown after the colon in powerline segments. */
export const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "active",
	waiting: "idle",
	done: "done",
	blocked: "blocked",
	stalled: "stalled",
	terminated: "dead",
	unknown: "?",
};

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

export const PL_SEP = "\uE0B0";
export const PL_SEP_THIN = "\uE0B1";

/** Build Powerline segments for all agents; self is bold accent. */
export function buildPowerlineSegments(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
): string[] {
	return sortRecords(records, selfId).map((rec) => {
		const sym = STATUS_SYMBOL[rec.status];
		const label = STATUS_LABEL[rec.status];
		const inbox =
			(rec.pendingMessages ?? 0) > 0
				? theme.fg("warning", `(✉${rec.pendingMessages})`)
				: "";
		if (rec.id === selfId)
			return `${sym} ${theme.fg("accent", theme.bold(rec.name))}${theme.fg("dim", `:${label}`)}${inbox}`;
		return `${sym} ${theme.fg(STATUS_COLOR[rec.status], rec.name)}${theme.fg("dim", `:${label}`)}${inbox}`;
	});
}

/** Render Powerline widget with ellipsis truncation to available width. */
export function renderPowerlineWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const segs = buildPowerlineSegments(records, selfId, theme);
	const separator = theme.fg("dim", ` ${PL_SEP_THIN} `);
	return [truncateToWidth(segs.join(separator), availableWidth)];
}
