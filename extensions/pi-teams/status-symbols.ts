/**
 * Shared status symbols for pi-teams TUI overlays.
 *
 * Reuses symbols from across pi extensions for consistency:
 * - `>` selection (team-overlay.ts team browser)
 * - `✓` success (pi-coas, pi-panopticon)
 * - `✗` failure (pi-coas, pi-panopticon)
 * - `⚠` warning (pi-coas)
 * - `⏸` paused/interrupted (kanban/watcher.ts line 191)
 * - `●` running (pi-panopticon/spawner.ts line 414)
 * - `⊘` skipped/dependency-failed
 * - `⇢` conditional-skip
 */

export const STATUS_SYMBOLS = {
	selection: ">",
	succeeded: "✓",
	failed: "✗",
	warning: "⚠",
	interrupted: "⏸",
	running: "●",
	skipped: "⊘",
	conditionalSkip: "⇢",
} as const;
