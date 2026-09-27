/** Trusted completion checks, run-local repair budgets, and honest blocked outcomes. */
import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runGateCommand, type GateResult } from "../../lib/gate-command.js";
import { commitGoal } from "./goal-command-state.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { goalScopeForContext, requireGoal } from "./goal-helpers.js";
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
 return pause(ctx, state, reason, resumeWhen);
}

async function pause(ctx: ExtensionContext, state: GoalState, reason: string, resumeWhen: string): Promise<GoalState> {
 const blocker = { reason: formatGoalDiagnostic(reason), resumeWhen: formatGoalDiagnostic(resumeWhen) };
 return commit(ctx, state, updateGoal(stopGoal(state, "interrupted", blocker.reason), { status: "paused", blocker }));
}

function repairLimit(): number {
 const raw = process.env.PI_GOAL_REPAIR_ATTEMPTS ?? "0";
 if (!/^[012]$/.test(raw)) throw new Error("PI_GOAL_REPAIR_ATTEMPTS must be 0, 1 or 2");
 return Number(raw);
}

function verifierTimeoutMs(): number {
 const raw = process.env.PI_GOAL_GATE_TIMEOUT_MS ?? String(15 * 60 * 1000);
 if (!/^\d+$/.test(raw)) throw new Error("PI_GOAL_GATE_TIMEOUT_MS must be 1000..86400000");
 const value = Number(raw);
 if (!Number.isSafeInteger(value) || value < 1000 || value > 24 * 60 * 60 * 1000) throw new Error("PI_GOAL_GATE_TIMEOUT_MS must be 1000..86400000");
 return value;
}

export async function verifyGoalCompletion(ctx: ExtensionContext, evidence: string, signal?: AbortSignal): Promise<CompletionOutcome> {
 const state = await requireGoal(ctx.cwd, goalScopeForContext(ctx));
 assertActive(state);
 const command = process.env.PI_GOAL_GATE_COMMAND;
 let maxAttempts: number;
 let timeoutMs: number;
 try { maxAttempts = 1 + repairLimit(); timeoutMs = verifierTimeoutMs(); }
 catch (error) { return { state: await pause(ctx, state, formatGoalDiagnostic(error), "Operator corrects the repair policy and explicitly resumes."), error: formatGoalDiagnostic(error) }; }
 if (!command?.trim() || signal?.aborted) {
  const error = signal?.aborted ? "Completion check cancelled." : "Completion requires an operator-configured verifier (PI_GOAL_GATE_COMMAND).";
  return { state: await pause(ctx, state, error, "Operator configures/reviews the verifier and explicitly resumes."), error };
 }
 const verifierHash = createHash("sha256").update(command).digest("hex");
 const runId = state.runId ?? "manual";
 const previous = state.completionCheck?.runId === runId ? state.completionCheck : undefined;
 if (previous?.status === "checking") throw new Error("A completion check is already in progress; review before explicit recovery.");
 if (previous && (previous.verifierHash !== verifierHash || previous.maxAttempts !== maxAttempts || previous.attempt >= previous.maxAttempts)) {
  const error = "Completion gate policy changed or check budget exhausted; explicit recovery required.";
  return { state: await pause(ctx, state, error, "Operator reviews verification state and explicitly resumes."), error };
 }
 const check: GoalCompletionCheck = { runId, verifierHash, attempt: (previous?.attempt ?? 0) + 1,
  maxAttempts, status: "checking", timestamp: new Date().toISOString(), summary: "Trusted verifier running." };
 const admitted = await commit(ctx, state, updateGoal(state, { completionCheck: check, blocker: undefined, lastError: undefined }));
 let gate: GateResult;
 const timeoutSignal = AbortSignal.timeout(timeoutMs);
 const gateSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
 try { gate = await runGateCommand(command, ctx.cwd, gateSignal); }
 catch (error) { gate = { passed: false, command, exitCode: -1, stdoutSummary: "", stderrSummary: formatGoalDiagnostic(error), failureKind: "execution" }; }
 if (timeoutSignal.aborted && !signal?.aborted) {
  gate = { ...gate, passed: false, failureKind: "execution", stderrSummary: "Completion verifier timed out." };
 }
 let policyChanged = false;
 try {
  const currentCommand = process.env.PI_GOAL_GATE_COMMAND ?? "";
  policyChanged = createHash("sha256").update(currentCommand).digest("hex") !== verifierHash
   || 1 + repairLimit() !== maxAttempts || verifierTimeoutMs() !== timeoutMs;
 } catch { policyChanged = true; }
 if (policyChanged) gate = { ...gate, passed: false, failureKind: "execution", stderrSummary: "Completion gate policy changed while verification was running." };
 const passed = gate.passed && !gateSignal.aborted;
 const retryable = !signal?.aborted && gate.failureKind === "validation";
 const summary = formatGoalDiagnostic(gate.stderrSummary.trim() || gate.stdoutSummary.trim() || (passed ? "Trusted verifier passed." : `Verifier failed (exit ${gate.exitCode}).`));
 const finished: GoalCompletionCheck = { ...check, status: passed ? "passed" : retryable ? "rejected" : "error",
  exitCode: gate.exitCode, summary, timestamp: new Date().toISOString() };
 if (passed) {
  const next = withLifecycle(updateGoal(admitted, { status: "complete", executionState: "completed", runActive: false,
   completionEvidence: evidence, completionCheck: finished, blocker: undefined, lastError: undefined,
   planRequired: false, planApproved: false, milestones: [], currentMilestoneIndex: 0, lastVerification: undefined }), "completed", "Goal completed by trusted verification.");
  return { state: await commit(ctx, admitted, next) };
 }
 const canRepair = admitted.runActive && retryable && check.attempt < check.maxAttempts;
 const error = `Completion gate failed (${check.attempt}/${check.maxAttempts}, exit ${gate.exitCode}). Verifier output (untrusted): ${summary}. ${canRepair ? "Repair the current scope and call goal_complete again." : "Run paused; explicit recovery required."}`;
 const rejected = updateGoal(admitted, { completionCheck: finished, lastError: formatGoalDiagnostic(error) });
 const next = canRepair ? rejected : updateGoal(stopGoal(rejected, "failed", formatGoalDiagnostic(error)), { status: "paused" });
 return { state: await commit(ctx, admitted, next), error };
}
