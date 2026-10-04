import { describe, expect, it, vi } from "vitest";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text, TuiAltScreen, TuiMainScreen, visibleWidth, type Terminal, type OverlayHandle } from "@earendil-works/pi-tui";
import { showGoalOverlay } from "../../extensions/pi-goal/goal-overlay.js";
import { collectChangedFiles } from "../../extensions/pi-goal/goal-helpers.js";
import { renderGoalOverlayLines, renderGoalSummary, renderGoalMarkdown } from "../../extensions/pi-goal/goal-render.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";

function makeGoal(overrides: Partial<GoalState> = {}): GoalState {
	return {
		schemaVersion: 2,
		revision: 0,
		goalId: "goal-1",
		objective: "Ship the deterministic overlay",
		status: "active",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		runActive: false,
		turnBudget: 20,
		turnsUsed: 3,
		currentMilestoneIndex: 0,
		milestones: [],
		...overrides,
	};
}

describe("Goal overlays on v1 renderers", () => {
	it.each(["regular", "fullscreen"] as const)("handles narrow widths, theme invalidation, focus and cleanup in %s mode", async mode => {
		const terminal: Terminal = { columns: 80, rows: 24, kittyProtocolActive: false, start() {}, stop() {}, async drainInput() {}, write() {}, moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
		const tui = mode === "regular" ? new TuiMainScreen(terminal) : new TuiAltScreen(terminal);
		const base = new Text("baseline"); tui.addChild(base); tui.setFocus(base);
		let color = 31;
		const theme = { fg: (_token: string, text: string) => `\u001b[${color}m${text}\u001b[0m`, bold: (text: string) => text };
		const custom = async (factory: Parameters<ExtensionCommandContext["ui"]["custom"]>[0]) => {
			let handle: OverlayHandle | undefined;
			let closed = false;
			const component = await factory(tui, theme as never, {} as never, () => { closed = true; handle?.hide(); });
			handle = tui.showOverlay(component);
			expect(handle.isFocused()).toBe(true);
			for (const width of [20, 40, 80]) expect(component.render(width).every(line => visibleWidth(line) <= width)).toBe(true);
			expect(component.render(40).join("\n")).toContain("\u001b[31m");
			color = 34; component.invalidate();
			expect(component.render(40).join("\n")).toContain("\u001b[34m");
			expect(component.render(40).join("\n")).not.toContain("\u001b[31m");
			component.handleInput?.("\u001b");
			expect(closed).toBe(true); expect(tui.hasOverlay()).toBe(false);
			expect(tui.getFocusedComponent()).toBe(base);
		};
		try { await showGoalOverlay({ mode: "tui", ui: { custom } } as unknown as ExtensionCommandContext, makeGoal()); }
		finally { tui.stop(); }
	});
	it.each(["rpc", "print"] as const)("does not open a terminal overlay in %s mode", async mode => {
		const notify = vi.fn(), custom = vi.fn();
		await showGoalOverlay({ mode, ui: { notify, custom } } as unknown as ExtensionCommandContext, makeGoal());
		expect(custom).not.toHaveBeenCalled(); expect(notify).toHaveBeenCalledOnce();
	});
});

describe("renderGoalOverlayLines", () => {
	it("collects a bounded reported changed-file summary", () => {
		const files = collectChangedFiles([
			{ role: "toolResult", details: { path: "src/main.ts", modifiedFiles: ["src/other.ts"] } },
		], Array.from({ length: 25 }, (_, index) => `old-${index}`));
		expect(files).toHaveLength(20);
		expect(files).toContain("src/main.ts");
		expect(renderGoalMarkdown(makeGoal({ changedFiles: files }))).toContain("## Changed files (bounded, reported)");
	});
	it("renders the normal goal details in stable line order", () => {
		expect(renderGoalOverlayLines(renderGoalSummary(makeGoal({
			sourcePath: "brief.md",
			planRequired: true,
			planApproved: true,
			milestones: [{
				id: "m1",
				title: "Implement",
				validationCommand: "npm test",
				status: "in_progress",
			}],
			completionEvidence: "Evidence recorded",
		})), 24)).toEqual([
			"Goal goal-1",
			"Status: active",
			"Source: brief.md",
			"Objective: Ship the deterministic overlay",
			"Completion executes the local hook in .pi/goal/settings.json.",
			"Evidence: Evidence recorded",
		]);
	});

	it("renders an empty goal without optional detail lines", () => {
		expect(renderGoalOverlayLines(renderGoalSummary(makeGoal({ objective: "" })), 24)).toEqual([
			"Goal goal-1",
			"Status: active",
			"Objective: ",
			"Completion executes the local hook in .pi/goal/settings.json.",
		]);
	});

	it("bounds long detail while preserving the overflow count", () => {
		const objective = Array.from({ length: 30 }, (_, index) => `detail-${index + 1}`).join("\n");
		const lines = renderGoalOverlayLines(renderGoalSummary(makeGoal({ objective })), 24);

		expect(lines).toHaveLength(24);
		expect(lines.slice(0, 2)).toEqual(["Goal goal-1", "Status: active"]);
		expect(lines[22]).toBe("detail-21");
		expect(lines[23]).toBe("… 10 more lines in .pi/goal/instances/<goalId>/GOAL.md");
	});
});
