/**
 * Machine Memory — TUI overlay for /mmem command.
 *
 * Renders a bordered table of all loaded memories with token counts
 * and source labels. Accepts indexTokens as a constructor param
 * instead of reading a module global.
 */

import type { Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import type { MemoryFile, MemorySource } from "./types.js";
import { estimateTokens } from "./format.js";

// ── Source labels ───────────────────────────────────────────────

const SOURCE_LABEL: Record<MemorySource, string> = {
	"settings": "📦 settings",
	"global": "🌐 global",
	"project": "📁 project",
	"deprecated-global": "⚠️  ~/.mmem",
	"deprecated-project": "⚠️  .mmem",
};

// ── Overlay component ───────────────────────────────────────────

export class MemoryOverlay {
	constructor(
		_tui: unknown,
		private theme: Theme,
		private memories: Map<string, MemoryFile>,
		private indexTokens: number,
		private done: (result: null) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "return")) {
			this.done(null);
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const innerW = Math.max(1, width - 4);
		const lines: string[] = [];

		// Title
		const title = ` 🧠 Machine Memory (${this.memories.size} files) `;
		const titleW = visibleWidth(title);
		const pad1 = "─".repeat(Math.floor((innerW - titleW) / 2));
		const pad2 = "─".repeat(Math.max(0, innerW - titleW - pad1.length));
		lines.push(th.fg("border", `  ╭${pad1}`) + th.fg("accent", title) + th.fg("border", `${pad2}╮`));

		if (this.memories.size === 0) {
			lines.push(th.fg("border", "  │") + truncateToWidth(th.fg("muted", " No memories loaded"), innerW, "...", true) + th.fg("border", "│"));
		} else {
			// Header
			const hdr = th.bold(" Name") + th.fg("muted", " │ ") + th.bold("Category") + th.fg("muted", " │ ") + th.bold("Source") + th.fg("muted", " │ ") + th.bold("Tokens");
			lines.push(th.fg("border", "  │") + truncateToWidth(hdr, innerW, "...", true) + th.fg("border", "│"));
			lines.push(th.fg("border", "  │") + th.fg("dim", "─".repeat(innerW)) + th.fg("border", "│"));

			for (const mem of this.memories.values()) {
				const tokens = estimateTokens(mem.raw);
				const conf = mem.meta.confidence === "high" ? th.fg("success", "✓")
					: mem.meta.confidence === "low" ? th.fg("warning", "?") : th.fg("muted", "~");
				const src = SOURCE_LABEL[mem.source] ?? mem.source;
				const row = ` ${conf} ${th.fg("accent", mem.name)}`
					+ th.fg("muted", " │ ") + th.fg("dim", mem.meta.category)
					+ th.fg("muted", " │ ") + th.fg("dim", src)
					+ th.fg("muted", " │ ") + th.fg("dim", `${tokens}`);
				lines.push(th.fg("border", "  │") + truncateToWidth(row, innerW, "...", true) + th.fg("border", "│"));
			}

			// Total
			const totalTokens = [...this.memories.values()].reduce((sum, m) => sum + estimateTokens(m.raw), 0);
			lines.push(th.fg("border", "  │") + th.fg("dim", "─".repeat(innerW)) + th.fg("border", "│"));
			const summary = th.fg("muted", ` Index: ~${this.indexTokens} tok (system prompt) │ Full: ~${totalTokens} tok (on demand)`);
			lines.push(th.fg("border", "  │") + truncateToWidth(summary, innerW, "...", true) + th.fg("border", "│"));
		}

		// Footer
		const footer = th.fg("dim", " Press Esc/q to close │ Use mmem_inject to load full content");
		lines.push(th.fg("border", "  │") + truncateToWidth(footer, innerW, "...", true) + th.fg("border", "│"));
		lines.push(th.fg("border", `  ╰${"─".repeat(innerW)}╯`));

		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}