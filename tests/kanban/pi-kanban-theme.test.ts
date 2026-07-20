import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import {
	applyKanbanTheme,
	kanbanThemeHelp,
	kanbanThemeName,
} from "../../extensions/pi-kanban/theme.js";

describe("pi-kanban theme", () => {
	let originalEnv: string | undefined;

	beforeEach(() => {
		originalEnv = process.env.KANBAN_BOARD_THEME;
		delete process.env.KANBAN_BOARD_THEME;
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.KANBAN_BOARD_THEME;
		} else {
			process.env.KANBAN_BOARD_THEME = originalEnv;
		}
	});

	describe("kanbanThemeHelp", () => {
		it("returns the correct help string", () => {
			expect(kanbanThemeHelp()).toBe("KANBAN_BOARD_THEME=default|focus|mono");
		});
	});

	describe("kanbanThemeName", () => {
		it("returns 'default' when env var is not set", () => {
			expect(kanbanThemeName()).toBe("default");
		});

		it("returns 'focus' when env var is 'focus'", () => {
			process.env.KANBAN_BOARD_THEME = "focus";
			expect(kanbanThemeName()).toBe("focus");
		});

		it("returns 'mono' when env var is 'mono'", () => {
			process.env.KANBAN_BOARD_THEME = "mono";
			expect(kanbanThemeName()).toBe("mono");
		});

		it("handles case and whitespace", () => {
			process.env.KANBAN_BOARD_THEME = "  FoCuS  ";
			expect(kanbanThemeName()).toBe("focus");
		});

		it("returns 'default' for unknown values", () => {
			process.env.KANBAN_BOARD_THEME = "unknown";
			expect(kanbanThemeName()).toBe("default");
		});
	});

	describe("applyKanbanTheme", () => {
		it("applies 'default' theme without mapping colors", () => {
			const fgMock = vi.fn().mockImplementation((c, t) => `fg(${c}, ${t})`);
			const mockTheme = { fg: fgMock } as unknown as Theme;

			const themed = applyKanbanTheme(mockTheme, "default");

			themed.fg("accent" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("accent", "text");
		});

		it("applies 'focus' theme mapping colors correctly", () => {
			const fgMock = vi.fn().mockImplementation((c, t) => `fg(${c}, ${t})`);
			const mockTheme = { fg: fgMock } as unknown as Theme;

			const themed = applyKanbanTheme(mockTheme, "focus");

			// accent -> warning
			themed.fg("accent" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("warning", "text");

			// border -> accent
			themed.fg("border" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("accent", "text");

			// muted -> dim
			themed.fg("muted" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("dim", "text");

			// unmapped color passes through
			themed.fg("error" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("error", "text");
		});

		it("applies 'mono' theme mapping colors correctly", () => {
			const fgMock = vi.fn().mockImplementation((c, t) => `fg(${c}, ${t})`);
			const mockTheme = { fg: fgMock } as unknown as Theme;

			const themed = applyKanbanTheme(mockTheme, "mono");

			// accent -> text
			themed.fg("accent" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("text", "text");

			// border -> dim
			themed.fg("border" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("dim", "text");

			// error -> text
			themed.fg("error" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("text", "text");

			// unmapped color passes through
			themed.fg("success" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("success", "text");
		});

		it("defaults to kanbanThemeName() when name is not provided", () => {
			process.env.KANBAN_BOARD_THEME = "focus";
			const fgMock = vi.fn().mockImplementation((c, t) => `fg(${c}, ${t})`);
			const mockTheme = { fg: fgMock } as unknown as Theme;

			const themed = applyKanbanTheme(mockTheme); // should use 'focus'

			themed.fg("accent" as ThemeColor, "text");
			expect(fgMock).toHaveBeenCalledWith("warning", "text");
		});
	});
});
