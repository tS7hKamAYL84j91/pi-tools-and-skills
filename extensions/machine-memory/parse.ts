/**
 * Machine Memory — frontmatter and content parsing.
 *
 * Simple YAML frontmatter parser (no library dependency) and
 * .mmem.yml → MemoryFile content parser.
 */

import type { MemoryMeta } from "./types.js";

// ── Parsing ─────────────────────────────────────────────────────

/** Parse YAML frontmatter from a .mmem.yml file. Simple parser — no YAML library needed. */
export function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } | null {
	const trimmed = raw.trimStart();
	if (!trimmed.startsWith("---")) return null;

	const endIdx = trimmed.indexOf("\n---", 3);
	if (endIdx === -1) return null;

	const yamlBlock = trimmed.slice(4, endIdx).trim();
	const body = trimmed.slice(endIdx + 4).trim();
	const meta: Record<string, unknown> = {};

	for (const line of yamlBlock.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx <= 0) continue;
		const key = line.slice(0, colonIdx).trim();
		let val: unknown = line.slice(colonIdx + 1).trim();

		// Parse YAML arrays: [item1, item2]
		if (typeof val === "string" && val.startsWith("[") && val.endsWith("]")) {
			val = val.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
		}
		// Strip quotes
		if (typeof val === "string" && val.startsWith('"') && val.endsWith('"')) {
			val = val.slice(1, -1);
		}
		meta[key] = val;
	}

	return { meta, body };
}

/** Parse a raw .mmem.yml string into a MemoryFile (minus path/source). */
export function parseMemoryContent(raw: string, fallbackName: string): Omit<{ name: string; meta: MemoryMeta; body: string; raw: string }, "path" | "source"> | null {
	const parsed = parseFrontmatter(raw);
	if (!parsed) return null;

	const { meta: rawMeta, body } = parsed;
	const tags = Array.isArray(rawMeta.tags) ? rawMeta.tags as string[] : [];

	const meta: MemoryMeta = {
		tool: (rawMeta.tool as string) ?? fallbackName,
		version: (rawMeta.version as string) ?? "any",
		updated: (rawMeta.updated as string) ?? "",
		category: (rawMeta.category as string) ?? "",
		tags,
		confidence: (["high", "medium", "low"].includes(rawMeta.confidence as string)
			? rawMeta.confidence : "medium") as MemoryMeta["confidence"],
	};

	return { name: meta.tool, meta, body, raw };
}