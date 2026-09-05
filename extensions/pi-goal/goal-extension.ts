/** Registers pi-goal UI/events; only the claimed command loop drives execution. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { GOAL_BINDING_CUSTOM_TYPE } from "./goal-binding.js";
import { continuationMarker, continuationMarkerComment, extractContinuationMarker } from "./goal-continuation.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { continuationPrompt, goalContextMessage } from "./prompts.js";
import { loadGoal, transactGoal } from "./goal-persist.js";
import { stopGoal, updateGoal } from "./goal-plan.js";
import { goalScopeForContext } from "./goal-helpers.js";
import { registerGoalCommands } from "./goal-commands.js";
import { registerGoalTools } from "./goal-tools.js";
import { startGoalWatchdog } from "./goal-watchdog.js";
import { findFinalAssistantMessage, getGoalRuntime, isCancelledContinuation, ownsGoal, refreshUi, stopLocalRun } from "./goal-runtime.js";

export default function goalExtension(pi: ExtensionAPI): void {
 const runtime = getGoalRuntime();
 let stopWatchdog: (() => void) | undefined;
 let stopped = false;
 registerGoalCommands(pi, runtime);
 registerGoalTools(pi, runtime, (ctx, state) => refreshUi(ctx, runtime, state));
 function localSession(ctx: ExtensionContext): boolean {
  return !stopped && runtime.driver !== undefined && runtime.driver.cwd === ctx.cwd && runtime.driver.sessionId === ctx.sessionManager.getSessionId?.();
 }
 pi.on("session_start", async (_event, ctx) => {
  stopped = false; stopWatchdog?.();
  const scope = goalScopeForContext(ctx, goalId => pi.appendEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId }));
  stopWatchdog = startGoalWatchdog({
   cwd: ctx.cwd, scope,
   getOwner: () => localSession(ctx) ? runtime.driver : undefined,
   isTurnActive: () => !ctx.isIdle(),
   hasQueuedContinuation: () => ctx.hasPendingMessages() || runtime.resolve !== null || runtime.pendingMarker !== null,
   notify: (message, level) => ctx.ui.notify(message, level),
   sendNudge: state => {
		const marker = continuationMarker(state.goalId, state.turnsUsed + 1);
		runtime.pendingMarker = marker;
		pi.sendUserMessage(`${continuationPrompt(state)}\n\n${continuationMarkerComment(marker)}`);
	},
   refresh: async state => refreshUi(ctx, runtime, state),
  });
  await refreshUi(ctx, runtime, undefined, scope);
 });
 pi.on("session_shutdown", async (event, ctx) => {
  stopWatchdog?.(); stopWatchdog = undefined;
  const local = localSession(ctx); stopped = true;
  if (!local || (event.reason === "new" && runtime.driver?.handoff)) { return; }
  try {
   const scope = goalScopeForContext(ctx);
   const state = await loadGoal(ctx.cwd, scope);
   if (state && ownsGoal(runtime, state)) {
    await transactGoal(ctx.cwd, scope, { goalId: state.goalId, revision: state.revision, owner: state.owner }, () => stopGoal(state, "interrupted", "Goal session shut down; explicit recovery required."));
   }
  } finally { stopLocalRun(runtime); }
 });
 pi.on("input", async event => {
  if (event.source === "extension" && isCancelledContinuation(runtime, event.text, extractContinuationMarker)) { return { action: "handled" }; }
 });
 pi.on("before_agent_start", async (_event, ctx) => {
  const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
  if (!state || (state.status !== "active" && state.status !== "planning")) { return; }
  return { message: { customType: "pi-goal-context", content: goalContextMessage(state), display: false, details: { goalId: state.goalId, runId: state.runId, turnsUsed: state.turnsUsed, turnBudget: state.turnBudget } } };
 });
 pi.on("agent_end", async (event, ctx) => {
  // agent_end only settles the matching waiter. It NEVER starts a second driver.
  if (!localSession(ctx)) { return; }
  const scope = goalScopeForContext(ctx);
  const state = await loadGoal(ctx.cwd, scope);
  if (!state || !ownsGoal(runtime, state)) { stopLocalRun(runtime); return; }
  const final = findFinalAssistantMessage(event.messages);
  if (final?.stopReason === "aborted" || final?.stopReason === "error") {
   try {
    const result = await transactGoal(ctx.cwd, scope, { goalId: state.goalId, revision: state.revision, owner: state.owner }, () => updateGoal(stopGoal(state, "interrupted", formatGoalDiagnostic(final.errorMessage ?? "Agent turn interrupted or failed.")), { status: "paused" }));
    if (result.status === "applied") {
			await refreshUi(ctx, runtime, result.state, scope);
			ctx.ui.notify("Goal paused after interruption/agent error. Run /goal resume to continue.", "info");
		}
   } finally { stopLocalRun(runtime, state.goalId); }
   return;
  }
  const resolve = runtime.resolve;
  runtime.resolve = null;
  resolve?.(event.messages);
 });
}
