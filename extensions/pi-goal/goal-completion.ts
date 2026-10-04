/** Completion runs the workspace-local validation hook, never trusts prose. */
import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { runGateCommand, type GateResult } from "../../lib/gate-command.js";
import { commitGoal } from "./goal-command-state.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { goalScopeForContext, requireGoal } from "./goal-helpers.js";
import { hookPath, readGoalHook, type GoalHook } from "./goal-hook.js";
import { stopGoal, updateGoal, withLifecycle } from "./goal-plan.js";
import type { GoalCompletionCheck, GoalState } from "./goal-types.js";

interface CompletionOutcome { readonly state: GoalState; readonly error?: string; }
function commit(ctx: ExtensionContext, previous: GoalState, candidate: GoalState): Promise<GoalState> {
 return commitGoal(ctx, goalScopeForContext(ctx), { goalId: previous.goalId, revision: previous.revision, owner: previous.owner }, candidate);
}
function assertActive(state: GoalState): void {
 if (state.status !== "active" && state.status !== "planning") throw new Error(`Cannot complete a ${state.status} goal`);
}
export async function blockGoal(ctx: ExtensionContext, reason: string, resumeWhen: string): Promise<GoalState> {
 if (!reason.trim() || !resumeWhen.trim()) throw new Error("goal_block requires a reason and resume condition");
 const state = await requireGoal(ctx.cwd, goalScopeForContext(ctx));
 assertActive(state);
 const blocker = { reason: formatGoalDiagnostic(reason), resumeWhen: formatGoalDiagnostic(resumeWhen) };
 return commit(ctx, state, updateGoal(stopGoal(state, "interrupted", blocker.reason), { status: "paused", blocker }));
}
function fingerprint(hook: GoalHook): string {
 return createHash("sha256").update(JSON.stringify(hook)).digest("hex");
}

export async function verifyGoalCompletion(ctx: ExtensionContext, evidence: string, signal?: AbortSignal): Promise<CompletionOutcome> {
 const state = await requireGoal(ctx.cwd, goalScopeForContext(ctx));
 assertActive(state);
 let hook: GoalHook | undefined;
 try { hook = await readGoalHook(ctx.cwd); }
 catch (error) { return { state, error: `Invalid local completion hook: ${formatGoalDiagnostic(error)}. Amend it with goal_hook or /goal hook.` }; }
 if (!hook?.command) return { state, error: "Completion hook missing in .pi/goal/settings.json. Configure it locally with goal_hook or /goal hook, then retry goal_complete. Goal remains open." };
 if (signal?.aborted) return { state, error: "Completion hook cancelled; goal remains open." };
 const verifierHash = fingerprint(hook);
 if (state.completionCheck?.status === "checking" && state.completionCheck.verifierHash === verifierHash) throw new Error("A completion check is already in progress; stop/recover explicitly if abandoned.");
 // One hook execution per explicit completion request, not a run-wide repair budget.
 const check: GoalCompletionCheck = { runId: state.runId ?? "manual", verifierHash, attempt: 1, maxAttempts: 1, status: "checking", timestamp: new Date().toISOString(), summary: "Local completion hook running." };
 const admitted = await commit(ctx, state, updateGoal(state, { completionCheck: check, blocker: undefined, lastError: undefined }));
 const timeoutSignal = AbortSignal.timeout(hook.timeoutMs);
 const gateSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
 let gate: GateResult;
 try { gate = await runGateCommand(hook.command, ctx.cwd, gateSignal); }
 catch (error) { gate = { passed: false, command: hook.command, exitCode: -1, stdoutSummary: "", stderrSummary: formatGoalDiagnostic(error), failureKind: "execution" }; }
 if (timeoutSignal.aborted && !signal?.aborted) gate = { ...gate, passed: false, failureKind: "execution", stderrSummary: "Completion hook timed out." };
 // Serialize configured edits with the final fingerprint check AND authority commit.
 return withAdvisoryLock(hookPath(ctx.cwd), async () => {
  let current: GoalHook | undefined;
  try { current = await readGoalHook(ctx.cwd); } catch { /* invalid configuration also invalidates this result */ }
  const changed = !current || fingerprint(current) !== verifierHash;
  if (changed) gate = { ...gate, passed: false, failureKind: "execution", stderrSummary: "Completion hook configuration changed while checking; result discarded. Retry with current settings." };
  const passed = gate.passed && !gateSignal.aborted;
  const summary = formatGoalDiagnostic(gate.stderrSummary.trim() || gate.stdoutSummary.trim() || (passed ? "Completion hook passed." : `Hook failed (exit ${gate.exitCode}).`));
  const finished: GoalCompletionCheck = { ...check, status: passed ? "passed" : gate.failureKind === "validation" ? "rejected" : "error", exitCode: gate.exitCode, summary, timestamp: new Date().toISOString() };
  if (passed) {
   const next = withLifecycle(updateGoal(admitted, { status: "complete", executionState: "completed", runActive: false, completionEvidence: evidence, completionCheck: finished, blocker: undefined, lastError: undefined, planRequired: false, planApproved: false, milestones: [], currentMilestoneIndex: 0, lastVerification: undefined }), "completed", "Goal completed after local hook validation.");
   return { state: await commit(ctx, admitted, next) };
  }
  const error = `Completion hook failed (exit ${gate.exitCode}). Hook output (untrusted): ${summary}. Goal remains open; repair or amend goal_hook locally, then retry goal_complete.`;
  return { state: await commit(ctx, admitted, updateGoal(admitted, { completionCheck: finished, lastError: formatGoalDiagnostic(error) })), error };
 });
}
