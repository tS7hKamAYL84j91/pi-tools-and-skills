/**
 * Markdown front-matter loading for declarative council descriptors.
 *
 * The parser intentionally supports only the small YAML subset used by built-in
 * subagent and team descriptors: scalar key/value pairs plus indented string
 * lists. Keeping it local and deterministic avoids adding a YAML dependency.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RawMarkdownDescriptor {
	frontMatter: Record<string, unknown>;
	path: string;
}

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseScalar(value: string): string | number {
	const unquoted = unquote(value);
	const numeric = Number(unquoted);
	return Number.isFinite(numeric) && /^\d+$/.test(unquoted) ? numeric : unquoted;
}

function parseFrontMatter(frontMatter: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	let currentListKey: string | undefined;
	for (const rawLine of frontMatter.split("\n")) {
		const line = rawLine.trimEnd();
		if (line.trim().length === 0) continue;
		const listMatch = /^\s*-\s*(.+)$/.exec(line);
		if (listMatch?.[1] && currentListKey) {
			const existing = result[currentListKey];
			const values = Array.isArray(existing) ? existing : [];
			values.push(unquote(listMatch[1]));
			result[currentListKey] = values;
			continue;
		}
		const keyMatch = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
		if (!keyMatch?.[1]) continue;
		const key = keyMatch[1];
		const value = keyMatch[2] ?? "";
		if (value.trim().length === 0) {
			result[key] = [];
			currentListKey = key;
			continue;
		}
		result[key] = parseScalar(value);
		currentListKey = undefined;
	}
	return result;
}

function readMarkdownDescriptor(path: string): RawMarkdownDescriptor | undefined {
	const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
	if (!raw.startsWith("---\n")) return undefined;
	const end = raw.indexOf("\n---\n", 4);
	if (end < 0) return undefined;
	return { frontMatter: parseFrontMatter(raw.slice(4, end)), path };
}

export function readMarkdownDescriptors(dir: string): RawMarkdownDescriptor[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".md"))
		.sort()
		.map((file) => readMarkdownDescriptor(join(dir, file)))
		.filter((entry): entry is RawMarkdownDescriptor => entry !== undefined);
}
