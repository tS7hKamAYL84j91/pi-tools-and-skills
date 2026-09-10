import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { WIP_LIMIT } from "../../extensions/pi-kanban/board.js";
import { openKanbanOverlay } from "../../extensions/pi-kanban/overlay.js";
import type { BoardWatchFactory } from "../../extensions/pi-kanban/overlay-watcher.js";
import { setupTempKanbanDir } from "./kanban-test-helpers.js";

function makeTheme(): Theme {
	return { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text, dim: (text: string) => text, italic: (text: string) => text, underline: (text: string) => text, strikethrough: (text: string) => text, inverse: (text: string) => text, fgColors: {}, bgColors: {}, mode: "light", color: (_name: string, text: string) => text, reset: () => "", strip: (text: string) => text, visibleWidth: (text: string) => text.length, truncateToWidth: (text: string) => text } as unknown as Theme;
}
interface Controller extends Component { handleInput(data: string): void; dispose(): void; }
/** Fake watch factory: hermetic controllers, manual event firing. */
function fakeWatchFactory(): { factory: BoardWatchFactory; fire: (event?: string) => void } {
	let callback: ((event: string, filename: string | Buffer | null) => void) | null = null;
	return {
		factory: (_path, handler) => {
			callback = handler;
			return { close: () => { callback = null; } };
		},
		fire: (event = "change") => callback?.(event, null),
	};
}

async function openController(factory: BoardWatchFactory = fakeWatchFactory().factory): Promise<Controller> {
	let controller: Controller | undefined;
	const tui = { requestRender: () => undefined } as unknown as TUI;
	const context = { ui: { notify: () => undefined, custom: async (factory: (tui: TUI, theme: Theme, keys: unknown, done: (result: null) => void) => Component) => { controller = factory(tui, makeTheme(), {}, () => undefined) as Controller; return null; } } } as unknown as ExtensionContext;
	await openKanbanOverlay(context, { watchFactory: factory });
	if (!controller) throw new Error("overlay controller was not created");
	return controller;
}

async function openWatchableController(): Promise<{ controller: Controller; fire: (event?: string) => void }> {
	const harness = fakeWatchFactory();
	const controller = await openController(harness.factory);
	return { controller, fire: harness.fire };
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
	it("bounds the board viewport and scrolls the selection into view", async () => {
		harness.writeBoardLog(Array.from({ length: 20 }, (_, index) => { const id = `T-${String(index + 20).padStart(3, "0")}`; return `2026-01-01T00:00:00Z CREATE ${id} lead title="Task ${id}" priority="medium" tags=""\n2026-01-01T00:00:01Z MOVE ${id} lead from=backlog to=in-progress`; }).join("\n"));
		const controller = await openController();
		try {
			// The body window is bounded; off-screen cards are not rendered.
			let output = controller.render(200).join("\n");
			expect(output).toContain("T-020");
			expect(output).not.toContain("T-039");
			// Navigate down 19 rows: scrolling keeps the selection visible.
			for (let index = 0; index < 19; index++) controller.handleInput("\x1b[B");
			output = controller.render(200).join("\n");
			expect(output).toContain("> T-039");
			expect(output).not.toContain("  T-020");
		} finally { controller.dispose(); }
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
			await flash(controller, "Complete denied: Agent operator is not the claimed owner of T-020 (claimed by worker-1)");
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
				await flash(controller, "Complete denied: Task T-020 requires verification evidence with all exit_code=0 before completion");
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

	it("refuses to reassign a task another actor claimed after the selection was cached", async () => {
		const base = [createLine("T-010", "Anchor"), "2026-01-01T00:00:01Z MOVE T-010 lead from=backlog to=todo"];
		seed(base);
		const controller = await openController();
		try {
			controller.handleInput(LEFT); // todo column, T-010 selected (cached view)
			// A competing actor claims the task after the overlay rendered its view.
			harness.writeBoardLog([...base, "2026-01-01T00:00:02Z CLAIM T-010 worker-1 expires=2026-01-02T00:00:00.000Z", "2026-01-01T00:00:02Z MOVE T-010 worker-1 from=todo to=in-progress"].join("\n") + "\n");
			controller.handleInput("c"); // stale view still says todo; the lock decides
			await flash(controller, "Claim unavailable: in-progress (owner worker-1) — use kanban_claim to reassign");
			expect(log()).not.toContain("UNCLAIM T-010");
			expect(log()).not.toContain("CLAIM T-010 operator");
		} finally { controller.dispose(); }
	});

	it("serializes operations: repeated keys while a gate runs are rejected as busy", async () => {
		const previousGate = process.env.KANBAN_GATE_COMMAND;
		process.env.KANBAN_GATE_COMMAND = "sleep 1";
		try {
			seed([createLine("T-020", "Owned"), "2026-01-01T00:00:01Z CLAIM T-020 operator expires=2026-01-02T00:00:00.000Z"]);
			const controller = await openController();
			try {
				controller.handleInput("x"); // starts the gate operation
				controller.handleInput("x"); // must be rejected while pending
				expect(controller.render(200).join("\n")).toContain("Busy — complete already running");
				await vi.waitFor(() => expect(log()).toContain("COMPLETE T-020 operator"), { timeout: 4_000 });
				expect(log().split("COMPLETE T-020").length - 1).toBe(1);
			} finally { controller.dispose(); }
		} finally {
			if (previousGate === undefined) delete process.env.KANBAN_GATE_COMMAND;
			else process.env.KANBAN_GATE_COMMAND = previousGate;
		}
	});

	it("aborts an in-flight gate on dispose without committing the completion", async () => {
		const previousGate = process.env.KANBAN_GATE_COMMAND;
		process.env.KANBAN_GATE_COMMAND = "sleep 1";
		try {
			seed([createLine("T-020", "Owned"), "2026-01-01T00:00:01Z CLAIM T-020 operator expires=2026-01-02T00:00:00.000Z"]);
			const controller = await openController();
			controller.handleInput("x");
			controller.dispose(); // abort signal fires while the gate runs
			await new Promise((resolve) => setTimeout(resolve, 1_500));
			expect(log()).not.toContain("COMPLETE T-020");
		} finally {
			if (previousGate === undefined) delete process.env.KANBAN_GATE_COMMAND;
			else process.env.KANBAN_GATE_COMMAND = previousGate;
		}
	});

	it("runs the configured gate from the overlay and denies on gate failure", async () => {
		const previousGate = process.env.KANBAN_GATE_COMMAND;
		try {
			seed([
				createLine("T-030", "Gate pass"),
				"2026-01-01T00:00:01Z CLAIM T-030 operator expires=2026-01-02T00:00:00.000Z",
			]);
			process.env.KANBAN_GATE_COMMAND = "exit 0";
			const passing = await openController();
			try {
				passing.handleInput("x");
				await flash(passing, "Completed T-030");
			} finally { passing.dispose(); }

			seed([
				createLine("T-031", "Gate fail"),
				"2026-01-01T00:00:01Z CLAIM T-031 operator expires=2026-01-02T00:00:00.000Z",
			]);
			process.env.KANBAN_GATE_COMMAND = "exit 1";
			const failing = await openController();
			try {
				failing.handleInput("x");
				await flash(failing, "Complete denied: kanban_complete gate failed for T-031 (exitCode=1)");
				expect(log()).not.toContain("COMPLETE T-031");
			} finally { failing.dispose(); }
		} finally {
			if (previousGate === undefined) delete process.env.KANBAN_GATE_COMMAND;
			else process.env.KANBAN_GATE_COMMAND = previousGate;
		}
	});

	it("reports a task-file write failure as partial success without losing the log event", async () => {
		seed([createLine("T-001", "Existing")]);
		const tasksDir = join(harness.tmpDir, "tasks");
		chmodSync(tasksDir, 0o500);
		const controller = await openController();
		try {
			controller.handleInput("n");
			for (const character of "Partial create") controller.handleInput(character);
			controller.handleInput(ENTER);
			await vi.waitFor(() => expect(log()).toContain('CREATE T-002 operator title="Partial create"'));
			await flash(controller, "Created T-002: Partial create (backlog; task file write failed");
			expect(existsSync(join(tasksDir, "T-002.md"))).toBe(false);
		} finally {
			chmodSync(tasksDir, 0o700);
			controller.dispose();
		}
	});

	it("accepts bracketed paste and unicode in the inline title prompt", async () => {
		seed([createLine("T-001", "Existing")]);
		const controller = await openController();
		try {
			controller.handleInput("n");
			controller.handleInput("\x1b[200~Café refactor ✅\x1b[201~");
			controller.handleInput(ENTER);
			await vi.waitFor(() => expect(log()).toContain('CREATE T-002 operator title="Café refactor ✅"'));
			await flash(controller, "Created T-002: Café refactor ✅ (backlog)");
		} finally { controller.dispose(); }
	});

	it("scrolls long detail content with up/down and clamps at the ends", async () => {
		const description = Array.from({ length: 150 }, (_, index) => `word-${String(index).padStart(3, "0")}`).join(" ");
		seed([`${createLine("T-040", "Long")} description="${description}"`, "2026-01-01T00:00:01Z MOVE T-040 lead from=backlog to=in-progress"]);
		const controller = await openController();
		try {
			controller.handleInput(ENTER); // enter detail view (in-progress column default)
			const detail = controller.render(80).join("\n");
			expect(detail).toContain("↑/↓ scroll (0/");
			controller.handleInput("\x1b[B");
			controller.handleInput("\x1b[B");
			expect(controller.render(80).join("\n")).toContain("↑/↓ scroll (2/");
			controller.handleInput("\x1b[A");
			expect(controller.render(80).join("\n")).toContain("↑/↓ scroll (1/");
			controller.handleInput("\x1b"); // back to board
			expect(controller.render(80).join("\n")).toContain("Kanban Board");
		} finally { controller.dispose(); }
	});

	it("reports not live when the board log disappears mid-session", async () => {
		seed([createLine("T-001", "Existing")]);
		const { controller, fire } = await openWatchableController();
		try {
			expect(controller.render(200).join("\n")).toContain("· live");
			unlinkSync(join(harness.tmpDir, "board.log"));
			fire("rename"); // deletion event; the debounced parse then fails
			await vi.waitFor(() =>
				expect(controller.render(200).join("\n")).toContain("· not live"),
				{ timeout: 4_000 },
			);
		} finally { controller.dispose(); }
	});
});
