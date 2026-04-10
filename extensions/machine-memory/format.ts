/**
 * Machine Memory — formatting and token estimation.
 *
 * Pure functions for rendering memory content into system-prompt
 * injection text and compact index entries.
 */

import type { MemoryFile } from "./types.js";

// ── Injection ───────────────────────────────────────────────────

/** Format memories for context injection. */
export function formatForInjection(memories: MemoryFile[]): string {
	if (memories.length === 0) return "";

	const sections = memories.map((m) => {
		return `<!-- mmem: ${m.path} -->\n${m.raw}`;
	});

	return [
		"<machine-memory>",
		"The following machine memory files provide compact tool/domain knowledge.",
		"",
		...sections,
		"</machine-memory>",
	].join("\n");
}

/**
 * Extract the one-line description from the body (H1 line after "—").
 * e.g. "# git — Distributed version control" → "Distributed version control"
 */
function extractDescription(body: string): string {
	const h1 = body.split("\n").find((l) => l.startsWith("# "));
	if (!h1) return "";
	const dashIdx = h1.indexOf("—");
	if (dashIdx === -1) return h1.slice(2).trim();
	return h1.slice(dashIdx + 1).trim();
}

/**
 * Format a compact index for system prompt injection.
 * Just tool names, tags, and one-line descriptions — ~30 tokens per memory.
 * The agent calls mmem_inject to load full content on demand.
 */
export function formatIndex(memories: MemoryFile[]): string {
	if (memories.length === 0) return "";

	const entries = memories.map((m) => {
		const desc = extractDescription(m.body);
		const tags = m.meta.tags.join(", ");
		return `  - **${m.name}** (${m.meta.category}) — ${desc}\n    Tags: ${tags}`;
	});

	return [
		"<available-memories>",
		"The following machine memory files are available. Use mmem_inject to load full content when needed.",
		"",
		...entries,
		"",
		"</available-memories>",
	].join("\n");
}

/** Estimate token count (rough: ~4 chars per token). */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}