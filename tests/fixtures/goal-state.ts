/** Test setup uses the production revision transaction, never a snapshot-write escape hatch. */
import { readFile } from "node:fs/promises";
import { readGoalBinding } from "../../extensions/pi-goal/goal-binding.js";
import type { GoalSessionScope } from "../../extensions/pi-goal/goal-binding.js";
import { transactGoalAt } from "../../extensions/pi-goal/goal-persist.js";
import { goalPaths } from "../../extensions/pi-goal/goal-types.js";
import type { GoalState } from "../../extensions/pi-goal/goal-types.js";

export async function writeGoalFixture(cwd: string, state: GoalState, scope?: GoalSessionScope): Promise<void> {
 const binding = scope?.sessionManager ? readGoalBinding(scope) : undefined;
 if (scope?.sessionManager && binding !== state.goalId) { throw new Error("Fixture goal binding mismatch"); }
 const id = typeof binding === "string" ? binding : undefined;
 let current: GoalState | undefined;
 try { current = JSON.parse(await readFile(goalPaths(cwd, id).statePath, "utf8")) as GoalState; }
 catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) { throw error; } }
 // Legacy fixture reseeding is explicit deletion+creation, not an unchecked state writer.
 if (current && current.goalId !== state.goalId) {
  await transactGoalAt(cwd, id, { goalId: current.goalId, revision: current.revision ?? 0 }, () => null);
  current = undefined;
 }
 const result = await transactGoalAt(cwd, id, current ? { goalId: current.goalId, revision: current.revision ?? 0 } : "absent", () => state, { allowOwnerChange: true });
 if (result.status !== "applied") { throw new Error("Fixture revision conflict"); }
 if (result.projection !== "complete") { throw new Error(result.projectionError); }
}
