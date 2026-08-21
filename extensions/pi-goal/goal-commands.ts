/** `/goal` command handlers and bounded execution loop. */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { continuationMarker, continuationMarkerComment } from "./goal-continuation.js";
import { showGoalOverlay } from "./goal-overlay.js";
import { continuationPrompt, kickoffPrompt } from "./prompts.js";
import { approvePlan, generatePlanState, invalidatePlan, startRun, updateGoal } from "./goal-plan.js";
import { loadGoal, saveGoal, clearGoal, createFileGoal, createFileTodoGoal, createTextGoal, writeGoalIteration } from "./goal-persist.js";
import type { GoalRuntime } from "./goal-runtime.js";
import { cancelContinuationPending, refreshUi } from "./goal-runtime.js";
import type { GoalState } from "./goal-types.js";
import { parseCommand, parseFileGoal, parseMilestonesFromRest, parseTurns, requireGoal, buildPlanReviewPrompt, UNTIL_COMPLETE_TURNS, goalStoppedMessage, goalHelpText, GOAL_HELP_COMMANDS } from "./goal-helpers.js";

type GoalCommandHandler = (ctx: ExtensionCommandContext, rest: string) => Promise<void>;

export function registerGoalCommands(pi: ExtensionAPI, runtime: GoalRuntime): void {
	async function showGoal(ctx: ExtensionCommandContext, state: GoalState): Promise<void> {
		await showGoalOverlay(ctx, state);
	}
	function showGoalHelp(): void {
		pi.sendMessage(
			{
				customType: "pi-goal-help",
				content: goalHelpText(),
				display: true,
				details: { commands: GOAL_HELP_COMMANDS },
			},
			{ triggerTurn: false },
		);
	}
	async function startAllowed(ctx: ExtensionContext): Promise<boolean> {
		const state = await loadGoal(ctx.cwd);
		if (state?.runActive) {
			ctx.ui.notify("A goal run is already active. Use /goal stop or /goal pause first.", "warning");
			return false;
		}
		return true;
	}
	async function runGoalLoop(ctx: ExtensionCommandContext, initialState: GoalState): Promise<void> {
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
			const afterTurn = updateGoal(latest, { turnsUsed: latest.turnsUsed + 1 });
			await writeGoalIteration(activeCtx.cwd, afterTurn, afterTurn.turnsUsed, messages);
			if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
				const stopped = updateGoal(afterTurn, { runActive: false });
				runtime.stopRequested = false;
				await saveGoal(activeCtx.cwd, stopped);
				await refreshUi(activeCtx, runtime, stopped);
				activeCtx.ui.notify(goalStoppedMessage(stopped), "info");
				return;
			}
			state = afterTurn;
			await saveGoal(activeCtx.cwd, state);
			await refreshUi(activeCtx, runtime, state);
		}
	}
	async function handleHelp(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		showGoalHelp();
		await refreshUi(ctx, runtime);
	}
	async function handleStatus(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await loadGoal(ctx.cwd);
		if (!state) {
			ctx.ui.notify("No active pi goal. Use /goal help to see available commands.", "info");
			await refreshUi(ctx, runtime, null);
			showGoalHelp();
			return;
		}
		await showGoal(ctx, state);
		await refreshUi(ctx, runtime, state);
	}
	async function handleFile(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const file = parseFileGoal(rest);
		if (!file.path) {
			ctx.ui.notify("Usage: /goal file <path> [goal start|--until-complete]", "warning");
			return;
		}
		if (file.untilComplete && !(await startAllowed(ctx))) return;
		const state = file.untilComplete ? await createFileTodoGoal(ctx.cwd, file.path) : await createFileGoal(ctx.cwd, file.path);
		const next = file.untilComplete ? startRun(state, UNTIL_COMPLETE_TURNS) : state;
		runtime.stopRequested = false;
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
		if (file.untilComplete) {
			await runGoalLoop(ctx, next);
		}
	}
	async function handlePlan(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		const milestones = parseMilestonesFromRest(rest);
		const planned = generatePlanState(
			state,
			milestones?.map((m) => ({ ...m })),
		);
		await saveGoal(ctx.cwd, planned);
		await refreshUi(ctx, runtime, planned);
		ctx.ui.notify("Plan generated. Review .pi/goal/PLAN.md, then run /goal approve or /goal run.", "info");
		try {
			await pi.sendUserMessage(buildPlanReviewPrompt(planned), { deliverAs: "followUp" });
		} catch {
			// Follow-up delivery is best-effort.
		}
	}

	async function handleApprove(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		if (!state.planRequired) {
			ctx.ui.notify("No plan is pending approval.", "info");
			return;
		}
		cancelContinuationPending(runtime);
		const approved = approvePlan(state);
		await saveGoal(ctx.cwd, approved);
		await refreshUi(ctx, runtime, approved);
		ctx.ui.notify("Plan approved. Use /goal run to start implementation.", "info");
	}

	async function handleGoal(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		if (!(await startAllowed(ctx))) return;
		runtime.stopRequested = false;
		const state = await createTextGoal(ctx.cwd, rest);
		const next = startRun(state, UNTIL_COMPLETE_TURNS);
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
		await runGoalLoop(ctx, next);
	}

	async function handleEdit(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		const trimmed = rest.trim();
		if (!trimmed) {
			ctx.ui.notify("Usage: /goal edit <new objective>", "warning");
			return;
		}
		cancelContinuationPending(runtime);
		const next = invalidatePlan(updateGoal(state, { objective: trimmed }));
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
		ctx.ui.notify("Goal updated. The plan has been invalidated; run /goal plan to replan.", "info");
	}

	async function handlePause(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		const next = updateGoal(state, { status: "paused", runActive: false });
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
	}

	async function handleResume(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		if (state.status === "complete") {
			ctx.ui.notify("Goal is complete; clear it before setting a new one.", "warning");
			return;
		}
		const next = updateGoal(state, { status: "active" });
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
	}

	async function handleClear(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		await clearGoal(ctx.cwd);
		await refreshUi(ctx, runtime, null);
		ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
	}

	async function handleRun(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		if (!(await startAllowed(ctx))) return;
		runtime.stopRequested = false;
		let state = await requireGoal(ctx.cwd);
		if (state.status === "complete") {
			ctx.ui.notify("Goal is already complete.", "info");
			return;
		}
		if (state.planRequired && !state.planApproved) {
			state = approvePlan(state);
			await saveGoal(ctx.cwd, state);
		}
		const turns = parseTurns(rest);
		const next = startRun(state, turns);
		await saveGoal(ctx.cwd, next);
		await refreshUi(ctx, runtime, next);
		await runGoalLoop(ctx, next);
	}

	async function handleStop(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd);
		if (!state.runActive) {
			ctx.ui.notify("No active goal run is in progress.", "info");
			return;
		}
		cancelContinuationPending(runtime);
		const stopped = updateGoal(state, { runActive: false });
		await saveGoal(ctx.cwd, stopped);
		const resolve = runtime.resolve;
		runtime.resolve = null;
		runtime.stopRequested = true;
		if (resolve) resolve([]);
		runtime.stopRequested = false;
		await refreshUi(ctx, runtime, stopped);
		ctx.ui.notify(goalStoppedMessage(stopped), "info");
	}

	const GOAL_COMMAND_HANDLERS: Record<string, GoalCommandHandler> = {
		clear: handleClear,
		edit: handleEdit,
		file: handleFile,
		goal: handleGoal,
		help: handleHelp,
		pause: handlePause,
		plan: handlePlan,
		approve: handleApprove,
		resume: handleResume,
		run: handleRun,
		show: handleStatus,
		status: handleStatus,
		stop: handleStop,
	};

	pi.registerCommand("goal", {
		description: "Manage a bounded project goal",
		handler: async (args, ctx) => {
			const parsed = parseCommand(args);
			const handler = GOAL_COMMAND_HANDLERS[parsed.action];
			if (handler) {
				await handler(ctx, parsed.rest);
				return;
			}
			ctx.ui.notify(`Unknown /goal option: ${parsed.rest || parsed.action}. Use /goal help.`, "warning");
			showGoalHelp();
		},
	});

	pi.registerCommand("goal-clear", {
		description: "Clear the active project-local pi goal",
		handler: async (_args, ctx) => {
			cancelContinuationPending(runtime);
			runtime.stopRequested = false;
			await clearGoal(ctx.cwd);
			await refreshUi(ctx, runtime, null);
			ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
		},
	});

}
