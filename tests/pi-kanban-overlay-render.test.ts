/**
 * Narrow render coverage for pi-kanban overlays.
 */

import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import type { TaskState } from "../extensions/pi-kanban/board.js";
import { renderConfirmDelete } from "../extensions/pi-kanban/overlay-render.js";

const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
} as unknown as import("@earendil-works/pi-coding-agent").Theme;

function task(overrides: Partial<TaskState> = {}): TaskState {
	return {
		id: "T-001",
		col: "todo",
		deleted: false,
		title: "A task with a deliberately long title for confirmation overlay coverage",
		priority: "medium",
		tags: "",
		description: "",
		agent: "",
		claimed: false,
		claimAgent: "",
		model: "",
		expires: "",
		reason: "",
		notes: [],
		completedAt: "",
		duration: "",
		doneAgent: "",
		createdAt: "2026-05-29T00:00:00.000Z",
		...overrides,
	};
}

function expectWidthBounded(lines: string[], width: number): void {
	for (const line of lines) {
		expect(visibleWidth(line)).toBeLessThanOrEqual(width);
	}
}

describe("pi-kanban overlay renderers", () => {
	it("renders standard delete confirmation keys within narrow widths", () => {
		const width = 50;
		const lines = renderConfirmDelete(task(), width, fakeTheme);
		const body = lines.join("\n");

		expect(body).toContain("Delete Task?");
		expect(body).toContain("T-001");
		expect(body).toContain("y confirm · esc/n cancel");
		expectWidthBounded(lines, width);
	});
});
