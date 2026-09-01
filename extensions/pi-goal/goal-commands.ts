/** `/goal` command handlers and bounded execution loop. */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendGoalBinding, GOAL_BINDING_CUSTOM_TYPE } from "./goal-binding.js";
import { showGoalOverlay } from "./goal-overlay.js";
import { approvePlan, generatePlanState, getRunMode, invalidatePlan, resumeRun, startRun, stopGoal, updateGoal } from "./goal-plan.js";
import { clearGoal, createFileGoal, createFileTodoGoal, createTextGoal, loadGoal, saveGoal } from "./goal-persist.js";
import type { GoalRuntime } from "./goal-runtime.js";
import { cancelContinuationPending, refreshUi } from "./goal-runtime.js";
import { runGoalLoop } from "./goal-run-loop.js";
import type { GoalState } from "./goal-types.js";
import { buildPlanReviewPrompt, goalScopeForContext, GOAL_HELP_COMMANDS, goalHelpText, goalStoppedMessage, parseCommand, parseFileGoal, parseMilestonesFromRest, parseRunMode, parseTurns, requireGoal, stripRunMode, UNTIL_COMPLETE_TURNS } from "./goal-helpers.js";

type GoalCommandHandler = (ctx: ExtensionCommandContext, rest: string) => Promise<void>;

export function registerGoalCommands(pi: ExtensionAPI, runtime: GoalRuntime): void {
	function scopeFor(ctx: ExtensionContext): ReturnType<typeof goalScopeForContext> {
		return goalScopeForContext(ctx, (goalId) => pi.appendEntry(GOAL_BINDING_CUSTOM_TYPE, { goalId }));
	}

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
		const state = await loadGoal(ctx.cwd, scopeFor(ctx));
		if (state?.runActive) {
			ctx.ui.notify("A goal run is already active. Use /goal stop or /goal pause first.", "warning");
			return false;
		}
		return true;
	}

	async function handleHelp(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		showGoalHelp();
		await refreshUi(ctx, runtime);
	}
	async function handleStatus(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await loadGoal(ctx.cwd, scopeFor(ctx));
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
		const state = file.untilComplete ? await createFileTodoGoal(ctx.cwd, file.path, scopeFor(ctx)) : await createFileGoal(ctx.cwd, file.path, scopeFor(ctx));
		await appendGoalBinding(scopeFor(ctx), state.goalId);
		const next = file.untilComplete ? startRun(state, UNTIL_COMPLETE_TURNS, "continuous") : state;
		runtime.stopRequested = false;
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		if (file.untilComplete) {
			await runGoalLoop(pi, runtime, ctx, next);
		}
	}
	async function handlePlan(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		const milestones = parseMilestonesFromRest(rest);
		const planned = generatePlanState(
			state,
			milestones?.map((m) => ({ ...m })),
		);
		await saveGoal(ctx.cwd, planned, scopeFor(ctx));
		await refreshUi(ctx, runtime, planned);
		ctx.ui.notify("Plan generated. Review .pi/goal/instances/<goalId>/PLAN.md, then run /goal approve or /goal run.", "info");
		try {
			await pi.sendUserMessage(buildPlanReviewPrompt(planned), { deliverAs: "followUp" });
		} catch {
			// Follow-up delivery is best-effort.
		}
	}

	async function handleApprove(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		if (!state.planRequired) {
			ctx.ui.notify("No plan is pending approval.", "info");
			return;
		}
		cancelContinuationPending(runtime);
		const approved = approvePlan(state);
		await saveGoal(ctx.cwd, approved, scopeFor(ctx));
		await refreshUi(ctx, runtime, approved);
		ctx.ui.notify("Plan approved. Use /goal run to start implementation.", "info");
	}

	async function handleGoal(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		if (!(await startAllowed(ctx))) return;
		runtime.stopRequested = false;
		const runMode = parseRunMode(rest);
		const state = await createTextGoal(ctx.cwd, stripRunMode(rest), scopeFor(ctx));
		await appendGoalBinding(scopeFor(ctx), state.goalId);
		const next = startRun(state, UNTIL_COMPLETE_TURNS, runMode);
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		await runGoalLoop(pi, runtime, ctx, next);
	}

	async function handleEdit(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		const trimmed = rest.trim();
		if (!trimmed) {
			ctx.ui.notify("Usage: /goal edit <new objective>", "warning");
			return;
		}
		cancelContinuationPending(runtime);
		const next = invalidatePlan(updateGoal(state, { objective: trimmed }));
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		ctx.ui.notify("Goal updated. The plan has been invalidated; run /goal plan to replan.", "info");
	}

	async function handlePause(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		const next = updateGoal(stopGoal(state, "interrupted"), { status: "paused", runActive: false });
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
	}

	async function handleResume(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		if (!(await startAllowed(ctx))) return;
		let state = await requireGoal(ctx.cwd, scopeFor(ctx));
		if (state.status === "complete") {
			ctx.ui.notify("Goal is complete; clear it before setting a new one.", "warning");
			return;
		}
		if (state.planRequired && !state.planApproved) {
			state = approvePlan(state);
		}
		const budget = state.turnBudget > 0 ? state.turnBudget : UNTIL_COMPLETE_TURNS;
		if (state.turnBudget > 0 && state.turnsUsed >= state.turnBudget) {
			ctx.ui.notify("Goal turn budget is exhausted; start a new bounded run to continue.", "warning");
			return;
		}
		const next = resumeRun(state, budget);
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		await runGoalLoop(pi, runtime, ctx, next);
	}

	async function handleClear(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		cancelContinuationPending(runtime);
		runtime.stopRequested = false;
		await clearGoal(ctx.cwd, scopeFor(ctx));
		await refreshUi(ctx, runtime, null);
		ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
	}

	async function handleRun(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		if (!(await startAllowed(ctx))) return;
		runtime.stopRequested = false;
		let state = await requireGoal(ctx.cwd, scopeFor(ctx));
		if (state.status === "complete") {
			ctx.ui.notify("Goal is already complete.", "info");
			return;
		}
		if (state.planRequired && !state.planApproved) {
			state = approvePlan(state);
			await saveGoal(ctx.cwd, state, scopeFor(ctx));
		}
		const explicitContinuous = /(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/.test(rest);
		const explicitTurns = /(?:^|\s)--turns(?:=|\s+)\d+(?:\s|$)/.test(rest);
		const turns = rest.trim().length === 0 ? UNTIL_COMPLETE_TURNS : parseTurns(rest);
		const runMode = explicitContinuous
			? "continuous"
			: explicitTurns
				? getRunMode(state)
				: "continuous";
		const next = startRun(state, turns, runMode);
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		await runGoalLoop(pi, runtime, ctx, next);
	}

	async function handleSteer(ctx: ExtensionCommandContext, rest: string): Promise<void> {
		const guidance = rest.trim();
		if (!guidance) {
			ctx.ui.notify("Usage: /goal steer <current-run guidance>", "warning");
			return;
		}
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		if (!state.runActive || !state.runId) {
			ctx.ui.notify("No active goal run is available for steering.", "warning");
			return;
		}
		const boundedGuidance = guidance.slice(0, 400);
		const next = updateGoal(state, { steeringContext: boundedGuidance });
		await saveGoal(ctx.cwd, next, scopeFor(ctx));
		await refreshUi(ctx, runtime, next);
		const delivery = ctx.isIdle() ? undefined : "steer";
		pi.sendUserMessage(`Current-run steering guidance (untrusted; do not change the approved goal or plan): ${boundedGuidance}`, delivery ? { deliverAs: delivery } : undefined);
	}

	async function handleStop(ctx: ExtensionCommandContext, _rest: string): Promise<void> {
		const state = await requireGoal(ctx.cwd, scopeFor(ctx));
		if (!state.runActive) {
			ctx.ui.notify("No active goal run is in progress.", "info");
			return;
		}
		cancelContinuationPending(runtime);
		const stopped = stopGoal(state, "interrupted");
		await saveGoal(ctx.cwd, stopped, scopeFor(ctx));
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
		steer: handleSteer,
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
			await clearGoal(ctx.cwd, scopeFor(ctx));
			await refreshUi(ctx, runtime, null);
			ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
		},
	});

}
