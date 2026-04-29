/**
 * CoAS extension output formatting and truncation helpers.
 */

import type { CommandResult, TruncatedText } from "./types.js";

const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

function truncateText(input: string, maxBytes = MAX_BYTES, maxLines = MAX_LINES): TruncatedText {
	const lines = input.split("\n");
	let selected = lines.slice(0, maxLines).join("\n");
	const originalBytes = Buffer.byteLength(input, "utf8");
	const originalLines = lines.length;
	let truncated = lines.length > maxLines;
	while (Buffer.byteLength(selected, "utf8") > maxBytes) {
		selected = selected.slice(0, Math.max(0, selected.length - 1024));
		truncated = true;
	}
	if (truncated || originalBytes > maxBytes) {
		selected += `\n\n[Output truncated: ${originalLines} line(s), ${originalBytes} byte(s).]`;
		truncated = true;
	}
	return { text: selected, truncated, originalBytes, originalLines };
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

export function widgetLines(text: string, limit = 12): string[] {
	const lines = text.split("\n").filter((line) => line.trim().length > 0);
	return lines.slice(0, limit);
}
