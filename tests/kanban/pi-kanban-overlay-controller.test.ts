import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { openKanbanOverlay } from "../../extensions/pi-kanban/overlay.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

function makeTheme(): Theme {
	return { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text, dim: (text: string) => text, italic: (text: string) => text, underline: (text: string) => text, strikethrough: (text: string) => text, inverse: (text: string) => text, fgColors: {}, bgColors: {}, mode: "light", color: (_name: string, text: string) => text, reset: () => "", strip: (text: string) => text, visibleWidth: (text: string) => text.length, truncateToWidth: (text: string) => text } as unknown as Theme;
}
interface Controller extends Component { handleInput(data: string): void; dispose(): void; }
async function openController(): Promise<Controller> {
	let controller: Controller | undefined;
	const tui = { requestRender: () => undefined } as unknown as TUI;
	const context = { ui: { notify: () => undefined, custom: async (factory: (tui: TUI, theme: Theme, keys: unknown, done: (result: null) => void) => Component) => { controller = factory(tui, makeTheme(), {}, () => undefined) as Controller; return null; } } } as unknown as ExtensionContext;
	await openKanbanOverlay(context);
	if (!controller) throw new Error("overlay controller was not created");
	return controller;
}
function selectedId(controller: Controller): string | undefined {
	return controller.render(200).map((line) => line.match(/> (T-\d+)/)?.[1]).find((id): id is string => id !== undefined);
}

describe("kanban overlay controller input contract", () => {
	const harness = setupTempKanbanDir("kanban-overlay-controller-test-");
	it("supports filter typing, backspace, enter, escape, and no-match views", async () => {
		harness.writeBoardLog(['2026-01-01T00:00:00Z CREATE T-010 lead title="Anchor" priority="high" tags=""', '2026-01-01T00:00:00Z CREATE T-011 lead title="Other" priority="low" tags=""', "2026-01-01T00:00:01Z MOVE T-010 lead from=backlog to=in-progress", "2026-01-01T00:00:01Z MOVE T-011 lead from=backlog to=in-progress"].join("\n"));
		const controller = await openController();
		try {
			controller.handleInput("/"); controller.handleInput("z"); expect(selectedId(controller)).toBeUndefined();
			controller.handleInput("\x7f"); expect(selectedId(controller)).toBe("T-010");
			for (const character of "other") controller.handleInput(character); expect(selectedId(controller)).toBe("T-011");
			controller.handleInput("\r"); expect(selectedId(controller)).toBe("T-011");
			controller.handleInput("/"); for (const character of "none") controller.handleInput(character); expect(selectedId(controller)).toBeUndefined();
			controller.handleInput("\x1b"); expect(selectedId(controller)).toBe("T-011");
		} finally { controller.dispose(); }
	});
	it("honors the existing all-rows viewport contract", async () => {
		harness.writeBoardLog(Array.from({ length: 12 }, (_, index) => { const id = `T-${String(index + 20).padStart(3, "0")}`; return `2026-01-01T00:00:00Z CREATE ${id} lead title="Task ${id}" priority="medium" tags=""\n2026-01-01T00:00:01Z MOVE ${id} lead from=backlog to=in-progress`; }).join("\n"));
		const controller = await openController();
		try { const output = controller.render(200).join("\n"); for (let index = 20; index < 32; index++) expect(output).toContain(`T-${String(index).padStart(3, "0")}`); } finally { controller.dispose(); }
	});
});
