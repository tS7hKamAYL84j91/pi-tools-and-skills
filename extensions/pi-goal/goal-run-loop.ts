/** Bounded goal turn loop; command registration delegates here to keep lifecycle flow focused. */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { continuationMarker, continuationMarkerComment } from "./goal-continuation.js";
import { continuationPrompt, kickoffPrompt } from "./prompts.js";
import { loadGoal, saveGoal, writeGoalIteration } from "./goal-persist.js";
import { getRunMode, stopGoal, updateGoal } from "./goal-plan.js";
import { collectChangedFiles, goalStoppedMessage } from "./goal-helpers.js";
import type { GoalRuntime } from "./goal-runtime.js";
import { cancelContinuationPending, refreshUi } from "./goal-runtime.js";
import type { GoalState } from "./goal-types.js";

export async function runGoalLoop(
	pi: ExtensionAPI,
	runtime: GoalRuntime,
	ctx: ExtensionCommandContext,
	initialState: GoalState,
): Promise<void> {
	if (initialState.planRequired && !initialState.planApproved) {
		ctx.ui.notify("Plan required but not approved. Run /goal plan first, then /goal approve or /goal run.", "warning");
		return;
	}
	let activeCtx: ExtensionCommandContext = ctx;
	let state = initialState;
	await activeCtx.waitForIdle();
	const originalSession = activeCtx.sessionManager.getSessionFile();

	while (state.runActive && state.status === "active" && state.turnsUsed < state.turnBudget) {
		if (runtime.stopRequested) break;
		const iteration = state.turnsUsed + 1;
		const rawPrompt = iteration === 1 ? kickoffPrompt(state) : continuationPrompt(state);
		const markedPrompt = iteration > 1
			? `${rawPrompt}\n\n${continuationMarkerComment(continuationMarker(state.goalId, iteration))}`
			: rawPrompt;
		runtime.pendingMarker = iteration > 1 ? continuationMarker(state.goalId, iteration) : null;

		const agentDone = new Promise<readonly unknown[]>((resolve) => {
			runtime.resolve = resolve;
		});

		if (iteration === 1) {
			activeCtx.ui.setStatus("goal", `goal: running ${state.turnsUsed}/${state.turnBudget}`);
			await pi.sendUserMessage(markedPrompt);
		} else {
			activeCtx.ui.setStatus("goal", `goal: running ${state.turnsUsed}/${state.turnBudget}`);
			const result = await activeCtx.newSession({
				...(originalSession ? { parentSession: originalSession } : {}),
				withSession: async (replacementCtx) => {
					activeCtx = replacementCtx;
					await replacementCtx.sendUserMessage(markedPrompt);
				},
			});
			if (result.cancelled) {
				runtime.resolve = null;
				runtime.pendingMarker = null;
				return;
			}
		}

		const messages = await agentDone;
		runtime.resolve = null;
		runtime.pendingMarker = null;

		const latest = await loadGoal(activeCtx.cwd);
		if (!latest || latest.status !== "active" || !latest.runActive) {
			runtime.stopRequested = false;
			await refreshUi(activeCtx, runtime, latest);
			return;
		}
		const afterTurn = updateGoal(latest, {
			turnsUsed: latest.turnsUsed + 1,
			executionState: "in_progress",
			changedFiles: collectChangedFiles(messages, latest.changedFiles),
		});
		await writeGoalIteration(activeCtx.cwd, afterTurn, afterTurn.turnsUsed, messages);
		if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
			const stopped = stopGoal(afterTurn, "interrupted", afterTurn.turnsUsed >= afterTurn.turnBudget ? "Goal turn budget exhausted." : "Goal stop requested.");
			runtime.stopRequested = false;
			await saveGoal(activeCtx.cwd, stopped);
			await refreshUi(activeCtx, runtime, stopped);
			activeCtx.ui.notify(goalStoppedMessage(stopped), "info");
			return;
		}
		state = updateGoal(afterTurn, { runMode: getRunMode(afterTurn) });
		await saveGoal(activeCtx.cwd, state);
		await refreshUi(activeCtx, runtime, state);
	}
	cancelContinuationPending(runtime);
}
