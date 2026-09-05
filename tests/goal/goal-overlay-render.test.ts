import { describe, expect, it } from "vitest";
import { collectChangedFiles } from "../../extensions/pi-goal/goal-helpers.js";
import { renderGoalOverlayLines, renderGoalSummary, renderStatusMarkdown } from "../../extensions/pi-goal/goal-render.js";
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

describe("renderGoalOverlayLines", () => {
	it("collects a bounded reported changed-file summary", () => {
		const files = collectChangedFiles([
			{ role: "toolResult", details: { path: "src/main.ts", modifiedFiles: ["src/other.ts"] } },
		], Array.from({ length: 25 }, (_, index) => `old-${index}`));
		expect(files).toHaveLength(20);
		expect(files).toContain("src/main.ts");
		expect(renderStatusMarkdown(makeGoal({ changedFiles: files }))).toContain("## Changed files (bounded, reported)");
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
			"Plan: approved · milestone 1/1",
			"Current milestone: Implement (in_progress)",
			"Objective: Ship the deterministic overlay",
			"Evidence: Evidence recorded",
		]);
	});

	it("renders an empty goal without optional detail lines", () => {
		expect(renderGoalOverlayLines(renderGoalSummary(makeGoal({ objective: "" })), 24)).toEqual([
			"Goal goal-1",
			"Status: active",
			"Objective: ",
		]);
	});

	it("bounds long detail while preserving the overflow count", () => {
		const objective = Array.from({ length: 30 }, (_, index) => `detail-${index + 1}`).join("\n");
		const lines = renderGoalOverlayLines(renderGoalSummary(makeGoal({ objective })), 24);

		expect(lines).toHaveLength(24);
		expect(lines.slice(0, 2)).toEqual(["Goal goal-1", "Status: active"]);
		expect(lines[22]).toBe("detail-21");
		expect(lines[23]).toBe("… 9 more lines in .pi/goal/instances/<goalId>/GOAL.md");
	});
});
