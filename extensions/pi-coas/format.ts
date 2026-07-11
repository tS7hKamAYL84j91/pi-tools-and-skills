/**
 * CoAS extension output formatting and truncation helpers.
 */

import type { CommandResult, SchedulerSnapshot, TruncatedText } from "./types.js";

const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

export function truncateText(input: string, maxBytes = MAX_BYTES, maxLines = MAX_LINES): TruncatedText {
	const lines = input.split("\n");
	let selected = lines.slice(0, maxLines).join("\n");
	const originalBytes = Buffer.byteLength(input, "utf8");
	const originalLines = lines.length;
	let truncated = lines.length > maxLines;
	let limitHit: "bytes" | "lines" | undefined = lines.length > maxLines ? "lines" : undefined;
	while (Buffer.byteLength(selected, "utf8") > maxBytes) {
		selected = selected.slice(0, Math.max(0, selected.length - 1024));
		truncated = true;
		limitHit = "bytes";
	}
	if (truncated || originalBytes > maxBytes) {
		selected += `\n\n[Output truncated: ${originalLines} line(s), ${originalBytes} byte(s).]`;
		truncated = true;
	}
	return { text: selected, truncated, originalBytes, originalLines, limitHit };
}

function commandText(result: CommandResult): string {
	const parts: string[] = [];
	if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
	if (result.stderr.trim()) parts.push(result.stderr.trimEnd());
	if (parts.length === 0) parts.push(`exit ${result.code}`);
	return parts.join("\n");
}

export function commandSummary(name: string, result: CommandResult): string {
	const body = truncateText(commandText(result));
	return `${name} exit=${result.code}\n\n${body.text}`;
}

export function shortCommandSummary(name: string, result: CommandResult, maxLines = 4): string {
	const body = commandText(result);
	const lines = body.split("\n").filter((line) => line.trim().length > 0);
	const selected = lines.slice(0, maxLines);
	if (lines.length > maxLines) selected.push("...");
	return `${name} exit=${result.code}\n${selected.join("\n")}`;
}

export function renderSchedulerSnapshot(snapshot: SchedulerSnapshot): string {
	const lines = [
		"CoAS internal scheduler",
		"=======================",
		`running           ${snapshot.running ? "yes" : "no"}`,
		`enabled schedules ${snapshot.enabledSchedules}`,
		`active runs       ${snapshot.activeRuns}`,
		`started at        ${snapshot.startedAt ?? "-"}`,
		`last error        ${snapshot.lastError ?? "none"}`,
	];
	if (snapshot.queued !== undefined && snapshot.queued > 0) lines.push(`queued            ${snapshot.queued}`);
	if (snapshot.failed !== undefined && snapshot.failed > 0) lines.push(`failed            ${snapshot.failed}`);
	if (snapshot.lastQueuedAt) lines.push(`last queued at    ${snapshot.lastQueuedAt}`);
	if (snapshot.lastFailedAt) lines.push(`last failed at    ${snapshot.lastFailedAt}`);
	if (snapshot.lastTaskId) lines.push(`last task id      ${snapshot.lastTaskId}`);
	return lines.join("\n");
}

export function widgetLines(text: string, limit = 12): string[] {
	if (limit <= 0) return [];
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	if (lines.length <= limit) return lines;
	return [...lines.slice(0, limit - 1), "..."];
}
