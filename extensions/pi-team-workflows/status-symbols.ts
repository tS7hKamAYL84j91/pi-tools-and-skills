/**
 * Shared status symbols for pi-team-workflows TUI overlays.
 *
 * Reuses symbols from across pi extensions for consistency:
 * - `>` selection (team-overlay.ts team browser)
 * - `✓` success (pi-automations, pi-agent-hub)
 * - `✗` failure (pi-automations, pi-agent-hub)
 * - `⚠` warning (pi-automations)
 * - `⏸` paused/interrupted (kanban/watcher.ts line 191)
 * - `●` running (pi-agent-hub/spawner.ts line 414)
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
