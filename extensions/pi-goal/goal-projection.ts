/** Derived goal summaries and terminal attempt evidence; authority is already committed. */
import { mkdir, rm } from "node:fs/promises";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { assertSafeEntry, assertSafeGoalRoot, removeKnownRunArtifacts } from "./goal-files.js";
import { writeTerminalGoalIteration } from "./goal-iteration.js";
import { renderGoalMarkdown } from "./goal-render.js";
import { goalPaths, type GoalState } from "./goal-types.js";

export async function regenerateDerivedFiles(cwd: string, state: GoalState, goalId?: string): Promise<void> {
 const paths = goalPaths(cwd, goalId);
 await mkdir(paths.dir, { recursive: true });
 await assertSafeEntry(paths.summaryPath, "projection");
 await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
}

export async function projectGoalMutation(cwd: string, goalId: string | undefined, previous: GoalState | null, next: GoalState | null): Promise<void> {
 const paths = goalPaths(cwd, goalId);
 if (next) {
  await regenerateDerivedFiles(cwd, next, goalId);
  await writeTerminalGoalIteration(cwd, goalId, previous, next);
  return;
 }
 const projectionPaths = [paths.summaryPath, paths.todoPath, paths.specPath, paths.planPath, paths.statusPath];
 for (const path of projectionPaths) await assertSafeEntry(path, "projection");
 await Promise.all(projectionPaths.map(path => rm(path, { force: true })));
 await removeKnownRunArtifacts(paths.runsPath);
 await assertSafeGoalRoot(cwd, goalId);
}
