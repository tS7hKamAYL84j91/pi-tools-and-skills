/**
 * Board-local theme remapping for the pi-kanban TUI overlay.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

const THEME_ENV = "KANBAN_BOARD_THEME";
const THEMES = ["default", "focus", "mono"] as const;

type KanbanThemeName = (typeof THEMES)[number];

const THEME_COLOR_MAP: Record<KanbanThemeName, Partial<Record<ThemeColor, ThemeColor>>> = {
	default: {},
	focus: {
		accent: "warning",
		border: "accent",
		muted: "dim",
	},
	mono: {
		accent: "text",
		border: "dim",
		error: "text",
		muted: "dim",
		warning: "text",
	},
};

function parseKanbanThemeName(value: string | undefined): KanbanThemeName {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "focus" || normalized === "mono") {
		return normalized;
	}
	return "default";
}

export function kanbanThemeName(): KanbanThemeName {
	return parseKanbanThemeName(process.env[THEME_ENV]);
}

export function kanbanThemeHelp(): string {
	return `${THEME_ENV}=default|focus|mono`;
}

export function applyKanbanTheme(theme: Theme, name: KanbanThemeName = kanbanThemeName()): Theme {
	const colorMap = THEME_COLOR_MAP[name];
	const themed = Object.create(theme) as Theme;
	themed.fg = (color: ThemeColor, text: string): string => theme.fg(colorMap[color] ?? color, text);
	return themed;
}
