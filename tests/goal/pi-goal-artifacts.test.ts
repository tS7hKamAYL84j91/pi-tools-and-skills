/** New goals keep source material and produce only one active Markdown summary. */
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFileGoal, createTextGoal, loadGoal } from "../../extensions/pi-goal/goal-persist.js";
import { goalPaths } from "../../extensions/pi-goal/goal-types.js";
import { writeGoalFixture } from "../fixtures/goal-state.js";

describe("goal artifacts", () => {
	it.each(["text", "file"])("creates %s goals without process scaffolding", async (kind) => {
		const root = await mkdtemp(join(tmpdir(), "goal-artifacts-"));
		try {
			const source = "# Requested work\n\n- [ ] Build the feature.\n";
			await writeFile(join(root, "TODO.md"), source);
			const state = kind === "file" ? await createFileGoal(root, "TODO.md") : await createTextGoal(root, "Build the feature");
			await writeGoalFixture(root, state);
			await loadGoal(root);
			const paths = goalPaths(root);
			expect((await readdir(paths.dir)).sort()).toEqual(["GOAL.md", "goal.json"]);
			expect(state.sourcePath).toBe(kind === "file" ? "TODO.md" : undefined);
			expect(await readFile(join(root, "TODO.md"), "utf8")).toBe(source);
			const summary = await readFile(paths.summaryPath, "utf8");
			expect(summary).toContain(state.objective);
			expect(summary).not.toMatch(/AUTONOMY RULE|Claim an item|Ready for review|dated note/);
		} finally { await rm(root, { recursive: true, force: true }); }
	});

	it("preserves existing projections and source history when loading a goal", async () => {
		const root = await mkdtemp(join(tmpdir(), "goal-history-"));
		try {
			await writeGoalFixture(root, await createTextGoal(root, "Resume existing work"));
			const paths = goalPaths(root);
			for (const name of ["TODO.md", "SPEC.md", "PLAN.md", "STATUS.md"]) await writeFile(join(paths.dir, name), `Existing ${name} history`);
			await loadGoal(root);
			for (const name of ["TODO.md", "SPEC.md", "PLAN.md", "STATUS.md"]) expect(await readFile(join(paths.dir, name), "utf8")).toBe(`Existing ${name} history`);
		} finally { await rm(root, { recursive: true, force: true }); }
	});
});
