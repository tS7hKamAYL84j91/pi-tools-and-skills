/** Registers pi-goal commands, tools, lifecycle hooks, and UI status. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { extractContinuationMarker } from "./goal-continuation.js";
import { continuationPrompt, goalContextMessage } from "./prompts.js";
import { loadGoal, saveGoal, writeGoalIteration } from "./goal-persist.js";
import { updateGoal } from "./goal-plan.js";
import { goalStoppedMessage } from "./goal-helpers.js";
import { registerGoalCommands } from "./goal-commands.js";
import { registerGoalTools } from "./goal-tools.js";
import {
	cancelContinuationPending,
	findFinalAssistantMessage,
	getGoalRuntime,
	isCancelledContinuation,
	refreshUi,
} from "./goal-runtime.js";

export default function goalExtension(pi: ExtensionAPI): void {
	const runtime = getGoalRuntime();
	registerGoalCommands(pi, runtime);
	registerGoalTools(pi, runtime, (ctx, state) => refreshUi(ctx, runtime, state));

	pi.on("session_start", async (_event, ctx) => {
		await refreshUi(ctx, runtime);
	});

	pi.on("input", async (event) => {
		if (event.source !== "extension") return;
		if (isCancelledContinuation(runtime, event.text, extractContinuationMarker)) {
			return { action: "handled" };
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = await loadGoal(ctx.cwd);
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
			const state = await loadGoal(ctx.cwd);
			if (state && state.status === "active" && state.runActive) {
				cancelContinuationPending(runtime);
				const paused = updateGoal(state, { status: "paused", runActive: false });
				await saveGoal(ctx.cwd, paused);
				await refreshUi(ctx, runtime, paused);
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
		const state = await loadGoal(ctx.cwd);
		if (!state || (state.status !== "active" && state.status !== "planning") || !state.runActive) {
			await refreshUi(ctx, runtime, state);
			return;
		}
		const afterTurn = updateGoal(state, { turnsUsed: state.turnsUsed + 1 });
		await writeGoalIteration(ctx.cwd, afterTurn, afterTurn.turnsUsed, event.messages as readonly unknown[]);
		if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
			const stopped = updateGoal(afterTurn, { runActive: false });
			runtime.stopRequested = false;
			await saveGoal(ctx.cwd, stopped);
			await refreshUi(ctx, runtime, stopped);
			pi.sendMessage({ customType: "pi-goal-run-stopped", content: goalStoppedMessage(stopped), display: true, details: stopped }, { triggerTurn: false });
			return;
		}
		await saveGoal(ctx.cwd, afterTurn);
		await refreshUi(ctx, runtime, afterTurn);
		try {
			pi.sendUserMessage(continuationPrompt(afterTurn), { deliverAs: "followUp" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stopped = updateGoal(afterTurn, { runActive: false, lastError: message });
			await saveGoal(ctx.cwd, stopped);
			await refreshUi(ctx, runtime, stopped);
			ctx.ui.notify(`Goal continuation fell back to single-run mode: ${message}`, "warning");
		}
	});
}
