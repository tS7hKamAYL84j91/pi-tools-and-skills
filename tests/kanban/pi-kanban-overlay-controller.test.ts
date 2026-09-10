import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { WIP_LIMIT } from "../../extensions/pi-kanban/board.js";
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

describe("kanban overlay board actions", () => {
	const harness = setupTempKanbanDir("kanban-overlay-actions-test-");
	const LEFT = "\x1b[D";
	const RIGHT = "\x1b[C";
	const ENTER = "\r";
	const ESC = "\x1b";

	function seed(lines: string[]): void {
		// Trailing newline is required: appended events glue onto the last line otherwise.
		harness.writeBoardLog(`${lines.join("\n")}\n`);
	}
	function createLine(id: string, title: string, priority = "medium"): string {
		return `2026-01-01T00:00:00Z CREATE ${id} lead title="${title}" priority="${priority}" tags=""`;
	}
	function log(): string {
		return harness.readBoardLog();
	}
	async function flash(controller: Controller, text: string): Promise<void> {
		await vi.waitFor(() =>
			expect(controller.render(200).join("\n")).toContain(text),
		);
	}

	it("claims the selected todo task under the overlay identity", async () => {
		seed([createLine("T-010", "Anchor", "high"), "2026-01-01T00:00:01Z MOVE T-010 lead from=backlog to=todo"]);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); // in-progress → todo
			controller.handleInput("c");
			await vi.waitFor(() => expect(log()).toContain("CLAIM T-010 operator expires="));
			expect(log()).toContain("MOVE T-010 operator from=todo to=in-progress");
			await flash(controller, "Claimed T-010 — now in-progress");
		} finally { controller.dispose(); }
	});

	it("completes an owned in-progress task with the same guards as the tool", async () => {
		seed([createLine("T-020", "Owned"), "2026-01-01T00:00:01Z CLAIM T-020 operator expires=2026-01-02T00:00:00.000Z"]);
		const controller = await openController();
		try {
			controller.handleInput("x");
			await vi.waitFor(() => expect(log()).toContain("COMPLETE T-020 operator duration=unknown"));
			expect(log()).toContain("MOVE T-020 operator from=in-progress to=done");
			await flash(controller, "Completed T-020");
		} finally { controller.dispose(); }
	});

	it("denies claiming when WIP is full and reports the limit", async () => {
		const lines = [createLine("T-010", "Next up", "high"), "2026-01-01T00:00:01Z MOVE T-010 lead from=backlog to=todo"];
		for (let index = 0; index < WIP_LIMIT; index++) {
			const id = `T-${String(20 + index).padStart(3, "0")}`;
			lines.push(createLine(id, `WIP ${id}`), `2026-01-01T00:00:02Z CLAIM ${id} worker-${index} expires=2026-01-02T00:00:00.000Z`);
		}
		seed(lines);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); controller.handleInput(LEFT); // → backlog (empty)
			controller.handleInput("c");
			await flash(controller, `Claim denied: WIP limit reached (${WIP_LIMIT}/${WIP_LIMIT})`);
			expect(log()).not.toContain("CLAIM T-010");
		} finally { controller.dispose(); }
	});

	it("denies completing a task owned by another agent", async () => {
		seed([createLine("T-020", "Owned"), "2026-01-01T00:00:01Z CLAIM T-020 worker-1 expires=2026-01-02T00:00:00.000Z"]);
		const controller = await openController();
		try {
			controller.handleInput("x");
			await flash(controller, "Complete denied: claimed by worker-1");
			expect(log()).not.toContain("COMPLETE T-020");
		} finally { controller.dispose(); }
	});

	it("denies completing when verification evidence is required", async () => {
		const previous = process.env.KANBAN_REQUIRE_CHECK_EVIDENCE;
		process.env.KANBAN_REQUIRE_CHECK_EVIDENCE = "1";
		try {
			seed([createLine("T-020", "Verified"), "2026-01-01T00:00:01Z CLAIM T-020 operator expires=2026-01-02T00:00:00.000Z"]);
			const controller = await openController();
			try {
				controller.handleInput("x");
				await flash(controller, "Complete denied: verification evidence required (use kanban_complete with checks)");
				expect(log()).not.toContain("COMPLETE T-020");
			} finally { controller.dispose(); }
		} finally {
			if (previous === undefined) delete process.env.KANBAN_REQUIRE_CHECK_EVIDENCE;
			else process.env.KANBAN_REQUIRE_CHECK_EVIDENCE = previous;
		}
	});

	it("creates a task from an inline title prompt with the next free id", async () => {
		seed([createLine("T-001", "Existing")]);
		const controller = await openController();
		try {
			controller.handleInput("n");
			expect(controller.render(200).join("\n")).toContain("New Task");
			for (const character of "Fix the flaky build") controller.handleInput(character);
			controller.handleInput(ENTER);
			await vi.waitFor(() =>
				expect(log()).toContain('CREATE T-002 operator title="Fix the flaky build" priority="medium"'),
			);
			expect(harness.readTaskFile("T-002")).toContain('title: "Fix the flaky build"');
			await flash(controller, "Created T-002: Fix the flaky build (backlog)");
		} finally { controller.dispose(); }
	});

	it("ignores an empty new-task title and cancels cleanly", async () => {
		seed([createLine("T-001", "Existing")]);
		const controller = await openController();
		try {
			controller.handleInput("n");
			controller.handleInput(ENTER);
			expect(log()).not.toContain("CREATE T-002");
			controller.handleInput("n");
			for (const character of "x") controller.handleInput(character);
			controller.handleInput(ESC);
			expect(log()).not.toContain("CREATE T-002");
			expect(controller.render(200).join("\n")).toContain("Kanban Board");
		} finally { controller.dispose(); }
	});

	it("blocks with a reason and unblocks back to todo", async () => {
		seed([
			createLine("T-030", "Stuck"),
			"2026-01-01T00:00:01Z CLAIM T-030 operator expires=2026-01-02T00:00:00.000Z",
		]);
		const controller = await openController();
		try {
			controller.handleInput("b");
			expect(controller.render(200).join("\n")).toContain("Block Task");
			for (const character of "waiting on upstream") controller.handleInput(character);
			controller.handleInput(ENTER);
			await vi.waitFor(() =>
				expect(log()).toContain('BLOCK T-030 operator reason="waiting on upstream"'),
			);
			expect(log()).toContain("MOVE T-030 operator from=in-progress to=blocked");
			await flash(controller, "Blocked T-030: waiting on upstream");
		} finally { controller.dispose(); }

		seed([
			createLine("T-031", "Also stuck"),
			"2026-01-01T00:00:01Z CLAIM T-031 worker-1 expires=2026-01-02T00:00:00.000Z",
			'2026-01-01T00:00:02Z BLOCK T-031 worker-1 reason="dependency"',
			"2026-01-01T00:00:02Z MOVE T-031 worker-1 from=in-progress to=blocked",
		]);
		const second = await openController();
		try {
			second.handleInput(RIGHT); // in-progress → blocked
			second.handleInput("u");
			await vi.waitFor(() => expect(log()).toContain("UNBLOCK T-031 operator resolution=\"\""));
			expect(log()).toContain("MOVE T-031 operator from=blocked to=todo");
			await flash(second, "Unblocked T-031 — back in todo");
		} finally { second.dispose(); }
	});

	it("no longer confirms deletion with enter; y confirms, n cancels", async () => {
		seed([createLine("T-040", "Backlog item")]);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); controller.handleInput(LEFT); // → backlog
			controller.handleInput("d");
			expect(controller.render(200).join("\n")).toContain("Delete Task?");
			controller.handleInput(ENTER); // must NOT confirm
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(log()).not.toContain("DELETE T-040");
			controller.handleInput("n");
			expect(log()).not.toContain("DELETE T-040");
			controller.handleInput("d");
			controller.handleInput("y");
			await vi.waitFor(() => expect(log()).toContain("DELETE T-040 operator"));
			await flash(controller, "Deleted T-040");
		} finally { controller.dispose(); }
	});

	it("move picker guards no-ops and moves on selection", async () => {
		seed([createLine("T-050", "Backlog only")]);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); controller.handleInput(LEFT); // → backlog
			controller.handleInput("m");
			expect(controller.render(200).join("\n")).toContain("[1] backlog (current)");
			controller.handleInput("1"); // current column → no-op
			await flash(controller, "Already in backlog");
			expect(log()).not.toContain("MOVE T-050");
			controller.handleInput("m");
			controller.handleInput("2");
			await vi.waitFor(() => expect(log()).toContain("MOVE T-050 operator from=backlog to=todo"));
			await flash(controller, "Moved T-050 → todo");
		} finally { controller.dispose(); }
	});

	it("attributes actions to KANBAN_OVERLAY_AGENT when configured", async () => {
		const previous = process.env.KANBAN_OVERLAY_AGENT;
		process.env.KANBAN_OVERLAY_AGENT = "jim";
		try {
			seed([createLine("T-010", "Anchor"), "2026-01-01T00:00:01Z MOVE T-010 lead from=backlog to=todo"]);
			const controller = await openController();
			try {
				controller.handleInput(LEFT);
				controller.handleInput("c");
				await vi.waitFor(() => expect(log()).toContain("CLAIM T-010 jim expires="));
			} finally { controller.dispose(); }
		} finally {
			if (previous === undefined) delete process.env.KANBAN_OVERLAY_AGENT;
			else process.env.KANBAN_OVERLAY_AGENT = previous;
		}
	});

	it("shows live refresh state and cycles themes in-session", async () => {
		seed([createLine("T-001", "Existing")]);
		const controller = await openController();
		try {
			expect(controller.render(200).join("\n")).toContain("· live");
			controller.handleInput("t");
			expect(controller.render(200).join("\n")).toContain("Theme: focus");
			controller.handleInput("t");
			expect(controller.render(200).join("\n")).toContain("Theme: mono");
			controller.handleInput("up"); // transient status clears on the next board key
			expect(controller.render(200).join("\n")).not.toContain("Theme: mono");
		} finally { controller.dispose(); }
	});

	it("clears transient status messages on the next board key", async () => {
		seed([createLine("T-001", "Backlog item")]);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); controller.handleInput(LEFT);
			controller.handleInput("m"); // backlog task: move picker opens
			controller.handleInput("1"); // no-op → status message
			await flash(controller, "Already in backlog");
			controller.handleInput("up");
			expect(controller.render(200).join("\n")).not.toContain("Already in backlog");
		} finally { controller.dispose(); }
	});
});
