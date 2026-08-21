/** Pure view-model helpers for the agent detail overlay. */
import type { SessionEvent } from "../../../lib/session-log.js";
import type { AgentRecord } from "../types.js";
import type { ThemeColor } from "./ui-format.js";

interface AgentDetailRow {
	label: string;
	value: string;
}

interface ActivityWindow {
	visibleEvents: SessionEvent[];
	hiddenCount: number;
}

export function buildAgentDetailRows(record: AgentRecord, uptime: string): AgentDetailRow[] {
	const rows: AgentDetailRow[] = [
		{ label: "Model", value: record.model || "unknown" },
		{ label: "CWD", value: record.cwd },
		{ label: "PID", value: String(record.pid) },
		{ label: "Messages", value: `msg:${record.pendingMessages ?? 0}` },
		{ label: "Uptime", value: uptime },
	];
	if (record.task) {
		rows.push({ label: "Task", value: record.task.slice(0, 60) });
	}
	return rows;
}

export function getActivityColor(event: string): ThemeColor {
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

export function formatActivityExtra(entry: SessionEvent): string {
	return Object.entries(entry)
		.filter(([key]) => key !== "ts" && key !== "event")
		.map(([key, value]) => `${key}=${String(value).slice(0, 60)}`)
		.join(" ");
}

export function getActivityWindow(events: readonly SessionEvent[], limit = 15): ActivityWindow {
	const visibleEvents = events.slice(-limit);
	return { visibleEvents, hiddenCount: events.length - visibleEvents.length };
}
