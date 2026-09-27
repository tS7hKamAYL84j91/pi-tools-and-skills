/** Confined per-attempt evidence artifacts, including terminal outcomes. */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import { assertNoSymlinkComponents, assertSafeGoalRoot } from "./goal-files.js";
import { renderIterationMarkdown } from "./goal-render.js";
import { assertGoalId, goalPaths, type GoalState } from "./goal-types.js";

interface IterationWrite {
 readonly goalId?: string;
 readonly state: GoalState;
 readonly iteration: number;
 readonly messages: readonly unknown[];
}

export async function writeTerminalGoalIteration(cwd: string, goalId: string | undefined, previous: GoalState | null, next: GoalState): Promise<void> {
 const admission = previous?.admission;
 if (!admission || (next.runActive && next.status === "active")) return;
 await writeGoalIterationFiles(cwd, { goalId, state: next, iteration: admission.attempt, messages: [{
  type: "goal-attempt-terminal", goalId: next.goalId, runId: next.runId, attempt: admission.attempt,
  outcome: next.executionState, revision: next.revision, completionCheck: next.completionCheck,
  blocker: next.blocker, lastError: next.lastError,
 }] });
}

export async function writeGoalIterationFiles(cwd: string, options: IterationWrite): Promise<void> {
 const runId = assertGoalId(options.state.runId ?? "manual");
 const now = new Date();
 const dir = join(goalPaths(cwd, options.goalId).runsPath, String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
 await assertSafeGoalRoot(cwd, options.goalId);
 await assertNoSymlinkComponents(cwd, dir);
 await mkdir(dir, { recursive: true });
 const prefix = `${runId}-iter-${String(options.iteration).padStart(3, "0")}`;
 await writeFileAtomic(join(dir, `${prefix}.jsonl`), `${options.messages.map(message => JSON.stringify(message)).join("\n")}\n`);
 await writeFileAtomic(join(dir, `${prefix}.md`), renderIterationMarkdown(options.state, options.iteration));
}
