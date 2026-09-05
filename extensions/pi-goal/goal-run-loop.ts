/** One owner drives a bounded goal; host calls stay outside authority transactions. */
import { realpath } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { GOAL_BINDING_CUSTOM_TYPE, readGoalBinding } from "./goal-binding.js";
import type { GoalSessionScope } from "./goal-binding.js";
import { continuationMarker, continuationMarkerComment } from "./goal-continuation.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { continuationPrompt, kickoffPrompt } from "./prompts.js";
import { loadGoal, transactGoal, writeGoalIteration } from "./goal-persist.js";
import { admitGoal, claimGoal, consumeReplacement, releaseGoal, reserveReplacement } from "./goal-ownership.js";
import { markProgress, stopGoal, updateGoal } from "./goal-plan.js";
import { collectChangedFiles, goalScopeForContext } from "./goal-helpers.js";
import type { GoalDriver, GoalRuntime } from "./goal-runtime.js";
import { cancelContinuationPending, refreshUi } from "./goal-runtime.js";
import type { GoalOwnerIdentity, GoalState } from "./goal-types.js";

function sameOwner(state: GoalState | null, owner: GoalOwnerIdentity): state is GoalState {
 return state?.owner?.token === owner.token && state.owner.generation === owner.generation;
}

/** Captured plain binding data, not a stale host SessionManager after replacement. */
function pinnedScope(ctx: ExtensionCommandContext): GoalSessionScope {
 const scope = goalScopeForContext(ctx);
 const entries = scope.sessionManager?.getBranch();
 return { cwd: ctx.cwd, ...(entries ? { sessionManager: { getBranch: () => entries } } : {}) };
}

export async function runGoalLoop(pi: ExtensionAPI, runtime: GoalRuntime, ctx: ExtensionCommandContext, _initialState: GoalState): Promise<void> {
 if (runtime.driver) { ctx.ui.notify("A local goal driver is still settling; stop it before starting another run.", "warning"); return; }
 const cwd = await realpath(ctx.cwd);
 const scope = pinnedScope(ctx);
 const originalSession = ctx.sessionManager.getSessionFile();
 const claimed = await claimGoal(cwd, scope);
 if (claimed.status !== "applied" || !claimed.state?.owner) {
  ctx.ui.notify("Goal ownership is unavailable. Use explicit /goal stop or /goal pause before recovery; existing claims never expire.", "warning"); return;
 }
 // Another local start may have claimed a different goal during our filesystem await.
 if (runtime.driver) { await releaseGoal(cwd, scope, claimed.state.owner); return; }
 const driver: GoalDriver = { ...claimed.state.owner, cwd, goalId: claimed.state.goalId, sessionId: ctx.sessionManager.getSessionId?.(), handoff: false };
 runtime.driver = driver; runtime.stopRequested = false;
 let activeCtx = ctx;
 try {
  if (claimed.projection === "failed") { throw new Error(claimed.projectionError ?? "Goal projection failed"); }
  while (!runtime.stopRequested) {
   await activeCtx.waitForIdle();
   const current = await loadGoal(cwd, scope);
   if (!sameOwner(current, driver) || !current.runActive || current.status !== "active") { return; }
   if (current.turnBudget > 0 && current.turnsUsed >= current.turnBudget) { await interrupt("Goal turn budget exhausted."); return; }
   const attempt = current.turnsUsed + 1;
   const marker = continuationMarker(current.goalId, attempt);
   const prompt = attempt === 1 ? kickoffPrompt(current) : `${continuationPrompt(current)}\n\n${continuationMarkerComment(marker)}`;
   const agentDone = new Promise<readonly unknown[]>(resolve => { runtime.resolve = resolve; });
   runtime.pendingMarker = attempt > 1 ? marker : null;
   if (attempt === 1) {
    const admitted = await admitGoal(cwd, scope, driver, attempt);
    if (admitted.status !== "applied" || admitted.projection !== "complete" || runtime.stopRequested) { return; }
    if (!activeCtx.isIdle() || activeCtx.hasPendingMessages()) { throw new Error("Goal host became busy before dispatch; resume explicitly"); }
    const progress = current.turnBudget > 0 ? `${current.turnsUsed}/${current.turnBudget}` : `${current.turnsUsed}/∞`;
    activeCtx.ui.setStatus("goal", `goal: running ${progress}`);
    pi.sendUserMessage(prompt);
   } else {
    const reserved = await reserveReplacement(cwd, scope, driver, attempt);
    if (reserved.status !== "applied" || reserved.projection !== "complete") { return; }
    driver.handoff = true;
    let expectedSessionId: string | undefined;
    let delivered = false;
    const result = await activeCtx.newSession({
     ...(originalSession ? { parentSession: originalSession } : {}),
     setup: async manager => {
      manager.appendCustomEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId: driver.goalId });
      expectedSessionId = manager.getSessionId();
      driver.sessionId = expectedSessionId;
     },
     withSession: async replacementCtx => {
      if (runtime.stopRequested) { return; }
      if (await realpath(replacementCtx.cwd) !== cwd) { throw new Error("Replacement goal workspace mismatch"); }
      const replacementScope = goalScopeForContext(replacementCtx);
      if (scope.sessionManager && (readGoalBinding(replacementScope) !== driver.goalId || !expectedSessionId || replacementCtx.sessionManager.getSessionId() !== expectedSessionId)) {
       throw new Error("Replacement goal session binding mismatch");
      }
      activeCtx = replacementCtx;
      await replacementCtx.waitForIdle();
      if (!replacementCtx.isIdle() || replacementCtx.hasPendingMessages() || runtime.stopRequested) { throw new Error("Replacement goal session is not idle"); }
      const consumed = await consumeReplacement(cwd, scope, driver, attempt);
      if (consumed.status !== "applied" || consumed.projection !== "complete") { throw new Error("Replacement reservation is stale or revoked"); }
      driver.handoff = false;
      delivered = true;
      await replacementCtx.sendUserMessage(prompt);
     },
    });
    if (result.cancelled || !delivered) { await interrupt("Goal replacement cancelled or outcome unknown; resume explicitly."); return; }
   }
   const messages = await agentDone;
   runtime.resolve = null; runtime.pendingMarker = null;
   const latest = await loadGoal(cwd, scope);
   if (!sameOwner(latest, driver) || !latest.runActive || runtime.stopRequested) { return; }
   const next = markProgress(updateGoal(latest, { turnsUsed: latest.turnsUsed + 1, admission: undefined, changedFiles: collectChangedFiles(messages, latest.changedFiles) }), `Completed turn ${attempt}.`);
   const result = await transactGoal(cwd, scope, { goalId: driver.goalId, revision: latest.revision, owner: driver }, () => next);
   if (result.status !== "applied" || !result.state) { return; }
   if (result.projection !== "complete") { throw new Error(result.projectionError ?? "Goal projection failed"); }
   await writeGoalIteration(cwd, result.state, attempt, { messages, scope });
   await refreshUi(activeCtx, runtime, result.state, scope);
  }
 } catch (error) {
  await interrupt(formatGoalDiagnostic(error));
 } finally {
  // Conditional release cannot mutate a successor, even after an await or failed UI.
  try { await releaseGoal(cwd, scope, driver); }
  finally {
   if (runtime.driver === driver) {
    const resolve = runtime.resolve; runtime.resolve = null; resolve?.([]);
    cancelContinuationPending(runtime); runtime.driver = undefined; runtime.stopRequested = false;
   }
  }
 }

 async function interrupt(message: string): Promise<void> {
  const latest = await loadGoal(cwd, scope);
  if (!sameOwner(latest, driver)) { return; }
  const result = await transactGoal(cwd, scope, { goalId: driver.goalId, revision: latest.revision, owner: driver }, () => stopGoal(latest, "interrupted", message));
  if (result.status !== "applied" || !result.state) { return; }
  if (result.projection !== "complete") { throw new Error(`Goal containment projection failed: ${result.projectionError}`); }
  // Replacement failures may leave an obsolete host. Authority is still safely stopped.
  if (!driver.handoff) {
   await refreshUi(activeCtx, runtime, result.state, scope);
   activeCtx.ui.notify(`Goal paused: ${message}. Use /goal resume after reviewing the outcome.`, "warning");
  }
 }
}
