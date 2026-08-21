/** Registers pi-goal commands, tools, lifecycle hooks, and UI status. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { continuationMarker, continuationMarkerComment, extractContinuationMarker } from "./goal-continuation.js";
import { GOAL_BINDING_CUSTOM_TYPE } from "./goal-binding.js";
import { continuationPrompt, goalContextMessage } from "./prompts.js";
import { loadGoal, saveGoal, writeGoalIteration } from "./goal-persist.js";
import { markProgress, stopGoal, updateGoal } from "./goal-plan.js";
import { collectChangedFiles, goalScopeForContext, goalStoppedMessage } from "./goal-helpers.js";
import { registerGoalCommands } from "./goal-commands.js";
import { registerGoalTools } from "./goal-tools.js";
import { startGoalWatchdog } from "./goal-watchdog.js";
import {
	cancelContinuationPending,
	findFinalAssistantMessage,
	getGoalRuntime,
	isCancelledContinuation,
	refreshUi,
} from "./goal-runtime.js";

export default function goalExtension(pi: ExtensionAPI): void {
	const runtime = getGoalRuntime();
	let stopWatchdog: (() => void) | undefined;
	registerGoalCommands(pi, runtime);
	registerGoalTools(pi, runtime, (ctx, state) => refreshUi(ctx, runtime, state));

	pi.on("session_start", async (_event, ctx) => {
		stopWatchdog?.();
		const scope = goalScopeForContext(ctx, (goalId) => pi.appendEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId }));
		stopWatchdog = startGoalWatchdog({
			cwd: ctx.cwd,
			scope,
			isTurnActive: () => !ctx.isIdle(),
			hasQueuedContinuation: () => ctx.hasPendingMessages() || runtime.resolve !== null || runtime.pendingMarker !== null,
			notify: (message, level) => ctx.ui.notify(message, level),
			sendNudge: (state) => {
				const marker = continuationMarker(state.goalId, state.livenessEpoch ?? 0);
				runtime.pendingMarker = marker;
				pi.sendUserMessage(`${continuationPrompt(state)}\n\n${continuationMarkerComment(marker)}`);
			},
			refresh: async (state) => refreshUi(ctx, runtime, state),
		});
		await refreshUi(ctx, runtime, undefined, scope);
		pi.on("session_shutdown", async () => {
			stopWatchdog?.();
			stopWatchdog = undefined;
			cancelContinuationPending(runtime);
		});
	});

	pi.on("input", async (event) => {
		if (event.source !== "extension") return;
		if (isCancelledContinuation(runtime, event.text, extractContinuationMarker)) {
			return { action: "handled" };
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
		if (!state || (state.status !== "active" && state.status !== "planning")) return;
		return {
			message: {
				customType: "pi-goal-context",
				content: goalContextMessage(state),
				display: false,
				details: { goalId: state.goalId, runId: state.runId, turnsUsed: state.turnsUsed, turnBudget: state.turnBudget },
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		const finalAssistant = findFinalAssistantMessage(event.messages);
		if (finalAssistant && (finalAssistant.stopReason === "aborted" || finalAssistant.stopReason === "error")) {
			const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
			if (state && state.status === "active" && state.runActive) {
				cancelContinuationPending(runtime);
				const paused = updateGoal(stopGoal(state, "interrupted", finalAssistant.errorMessage ?? "Agent turn interrupted or failed."), { status: "paused", runActive: false });
				await saveGoal(ctx.cwd, paused, goalScopeForContext(ctx));
				await refreshUi(ctx, runtime, paused, goalScopeForContext(ctx));
				ctx.ui.notify("Goal paused after interruption/agent error. Run /goal resume to continue.", "info");
				if (runtime.resolve) {
					const resolve = runtime.resolve;
					runtime.resolve = null;
					resolve([]);
				}
				return;
			}
		}

		if (runtime.resolve) {
			const resolve = runtime.resolve;
			runtime.resolve = null;
			resolve(event.messages as readonly unknown[]);
			return;
		}
		const state = await loadGoal(ctx.cwd, goalScopeForContext(ctx));
		if (!state || (state.status !== "active" && state.status !== "planning") || !state.runActive) {
			await refreshUi(ctx, runtime, state, goalScopeForContext(ctx));
			return;
		}
		const afterTurn = markProgress(updateGoal(state, {
			turnsUsed: state.turnsUsed + 1,
			executionState: "in_progress",
			changedFiles: collectChangedFiles(event.messages as readonly unknown[], state.changedFiles),
		}), `Completed turn ${state.turnsUsed + 1}.`);
		await writeGoalIteration(ctx.cwd, afterTurn, afterTurn.turnsUsed, { messages: event.messages as readonly unknown[], scope: goalScopeForContext(ctx) });
		if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
			const stopped = stopGoal(afterTurn, "interrupted", afterTurn.turnsUsed >= afterTurn.turnBudget ? "Goal turn budget exhausted." : "Goal stop requested.");
			runtime.stopRequested = false;
			await saveGoal(ctx.cwd, stopped, goalScopeForContext(ctx));
			await refreshUi(ctx, runtime, stopped, goalScopeForContext(ctx));
			pi.sendMessage({ customType: "pi-goal-run-stopped", content: goalStoppedMessage(stopped), display: true, details: stopped }, { triggerTurn: false });
			return;
		}
		await saveGoal(ctx.cwd, afterTurn, goalScopeForContext(ctx));
		await refreshUi(ctx, runtime, afterTurn, goalScopeForContext(ctx));
		try {
			pi.sendUserMessage(continuationPrompt(afterTurn), { deliverAs: "followUp" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stopped = updateGoal(afterTurn, { runActive: false, lastError: message });
			await saveGoal(ctx.cwd, stopped, goalScopeForContext(ctx));
			await refreshUi(ctx, runtime, stopped, goalScopeForContext(ctx));
			ctx.ui.notify(`Goal continuation fell back to single-run mode: ${message}`, "warning");
		}
	});
}
