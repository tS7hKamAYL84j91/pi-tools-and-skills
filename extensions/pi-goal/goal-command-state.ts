/** Command mutation/error boundary shared by the goal operator handlers. */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { goalScopeForContext, goalHelpText, GOAL_HELP_COMMANDS } from "./goal-helpers.js";
import { loadGoal, transactGoal, transactGoalAt } from "./goal-persist.js";
import { stopGoal, updateGoal } from "./goal-plan.js";
import type { GoalRuntime } from "./goal-runtime.js";
import { refreshUi, stopLocalRun } from "./goal-runtime.js";
import type { GoalExpected, GoalState } from "./goal-types.js";

export function showGoalHelp(pi: ExtensionAPI): void {
 pi.sendMessage({ customType: "pi-goal-help", content: goalHelpText(), display: true, details: { commands: GOAL_HELP_COMMANDS } }, { triggerTurn: false });
}

export async function clearBoundGoal(ctx: ExtensionCommandContext, scope: ReturnType<typeof goalScopeForContext>, runtime: GoalRuntime): Promise<void> {
 const state = await loadGoal(ctx.cwd, scope);
 try {
  if (!state) { if (scope.sessionManager) { await scope.appendBinding?.(null); } return; }
  const result = await transactGoal(ctx.cwd, scope, { goalId: state.goalId, revision: state.revision }, () => null);
  if (result.status === "conflict") { throw new Error("Goal clear conflicted with a newer authoritative revision"); }
  try { if (scope.sessionManager) { await scope.appendBinding?.(null); } }
  catch (error) { throw new Error(`Goal deleted but binding cleanup is uncertain: ${formatGoalDiagnostic(error)}`); }
  if (result.projection === "failed") { throw new Error(`Goal authority deleted but cleanup failed: ${result.projectionError}`); }
 } finally { if (state) { stopLocalRun(runtime, state.goalId); } }
}

export async function commitGoal(ctx: ExtensionContext, scope: ReturnType<typeof goalScopeForContext>, expected: GoalExpected, candidate: GoalState): Promise<GoalState> {
 const result = expected === "absent" && scope.sessionManager
  ? await transactGoalAt(ctx.cwd, candidate.goalId, expected, () => candidate)
  : await transactGoal(ctx.cwd, scope, expected, () => candidate);
 if (result.status === "conflict") { throw new Error("Goal mutation conflicted with a newer authoritative revision"); }
 if (result.projection === "failed") { throw new Error(`Goal authority committed but projection failed: ${result.projectionError}`); }
 if (!result.state) { throw new Error("Goal mutation unexpectedly deleted the goal"); }
 return result.state;
}

export async function pauseAfterSteeringFailure(ctx: ExtensionCommandContext, runtime: GoalRuntime, state: GoalState, error: unknown): Promise<void> {
 try {
  const paused = updateGoal(stopGoal(state, "interrupted", formatGoalDiagnostic(error)), { status: "paused" });
  const persisted = await commitGoal(ctx, goalScopeForContext(ctx), { goalId: state.goalId, revision: state.revision }, paused);
  await refreshUi(ctx, runtime, persisted);
  ctx.ui.notify("Goal paused after a steering error. Run /goal resume to continue.", "warning");
 } finally { stopLocalRun(runtime, state.goalId); }
}
