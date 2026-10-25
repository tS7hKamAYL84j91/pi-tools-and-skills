/**
 * Cockpit decisions panel — read-only navigation over the public SPR decision log.
 *
 * Reads one explicitly configured Markdown file (`docs/decisions.md` shape:
 * `- NNN Title — facts`, one decision per line). Never writes, never imports
 * another extension's private state, never infers authority from the file.
 * Size is bounded so a large log cannot stall the UI.
 */
import { readFileSync, statSync } from "node:fs";

export interface DecisionEntry {
	number: string;
	title: string;
	facts: string;
}

/** Refuse absurd inputs rather than reading unbounded files into the UI. */
const MAX_BYTES = 1024 * 1024;

export function parseDecisionLog(markdown: string): DecisionEntry[] {
	const entries: DecisionEntry[] = [];
	// `- NNN Title — facts`, tolerating a plain hyphen or en/em dash separator.
	const linePattern = /^-\s+(\d{3})\s+(\S.*)$/;
	for (const rawLine of markdown.split("\n")) {
		const match = linePattern.exec(rawLine);
		if (match === null) continue;
		const number = match[1] ?? "";
		const remainder = match[2] ?? "";
		const separator = remainder.search(/\s(?:—|–|-)\s/);
		if (separator === -1) {
			entries.push({ number, title: remainder.trim(), facts: "" });
			continue;
		}
		entries.push({
			number,
			title: remainder.slice(0, separator).trim(),
			facts: remainder.slice(separator).replace(/^\s(?:—|–|-)\s/, "").trim(),
		});
	}
	return entries;
}

export function loadDecisionLog(path: string): DecisionEntry[] {
	const size = statSync(path).size;
	if (size > MAX_BYTES) {
		throw new Error(`decisions file is too large to display (${size} bytes > ${MAX_BYTES})`);
	}
	return parseDecisionLog(readFileSync(path, "utf8"));
}

/** Case-insensitive substring filter over number, title, and facts. */
export function filterDecisions(
	entries: readonly DecisionEntry[],
	query: string,
): DecisionEntry[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [...entries];
	return entries.filter((entry) =>
		`${entry.number} ${entry.title} ${entry.facts}`.toLowerCase().includes(needle),
	);
}

/** Single-line label used by the decision list. */
export function decisionLabel(entry: DecisionEntry): string {
	return `${entry.number} ${entry.title}`;
}