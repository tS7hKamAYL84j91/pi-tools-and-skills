/**
 * Registers the pi-goal command, tools, lifecycle hooks, and UI status.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { continuationMarker, continuationMarkerComment, extractContinuationMarker } from "./goal-continuation.js";
import { showGoalOverlay } from "./goal-overlay.js";
import { continuationPrompt, goalContextMessage, kickoffPrompt } from "./prompts.js";
import {
	approvePlan,
	generatePlanState,
	invalidatePlan,
	startRun,
	updateGoal,
} from "./goal-plan.js";
import { loadGoal, saveGoal, clearGoal, createFileGoal, createFileTodoGoal, createTextGoal, writeGoalIteration } from "./goal-persist.js";
import { registerGoalTools, type GoalRuntime } from "./goal-tools.js";
import type { GoalState } from "./goal-types.js";

const DEFAULT_TURNS = 3;
const UNTIL_COMPLETE_TURNS = 20;
const MAX_CANCELLED_MARKERS = 20;
const GOAL_HELP_COMMANDS = [
	"/goal help — show this command summary",
	"/goal status — show the current goal",
	"/goal <text> — create a text goal and start a bounded run",
	"/goal file <path> [goal start|--until-complete] — create a file-backed goal",
	"/goal plan [milestone title] — generate a reviewable plan and pause for approval",
	"/goal approve — accept the generated plan and allow implementation",
	"/goal run [--turns N|--until-complete] — continue an active or paused goal",
	"/goal pause | resume | stop — manage the current goal run",
	"/goal edit <text> — update the objective of the active goal (invalidates the plan)",
	"/goal clear — remove .pi/goal/ state and local run artifacts for this workspace",
] as const;
const KNOWN_ACTIONS = new Set(["show", "status", "help", "file", "plan", "approve", "pause", "resume", "clear", "run", "stop", "edit"]);
const GOAL_RUNTIME_KEY = Symbol.for("pi-goal.runtime");

export default function goalExtension(pi: ExtensionAPI): void {
	const runtime = getGoalRuntime();

	async function refreshUi(ctx: ExtensionContext, state?: GoalState | null): Promise<void> {
		const current = state === undefined ? await loadGoal(ctx.cwd) : state;
		if (!current || current.status === "complete") {
			ctx.ui.setStatus("goal", undefined);
			ctx.ui.setWidget("goal", undefined);
			return;
		}
		const stop = runtime.stopRequested ? " stopping" : "";
		const run = current.runActive ? ` ${current.turnsUsed}/${current.turnBudget}${stop}` : "";

		const phase = current.runActive ? "running" : current.status;
		ctx.ui.setStatus("goal", `goal: ${phase}${run}`);
		ctx.ui.setWidget("goal", [`goal: ${phase} ${current.turnsUsed}/${current.turnBudget} · /goal status for details`]);
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
				await refreshUi(activeCtx, latest);
				return;
			}
			const afterTurn = updateGoal(latest, { turnsUsed: latest.turnsUsed + 1 });
			await writeGoalIteration(activeCtx.cwd, afterTurn, afterTurn.turnsUsed, messages);
			if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
				const stopped = updateGoal(afterTurn, { runActive: false });
				runtime.stopRequested = false;
				await saveGoal(activeCtx.cwd, stopped);
				await refreshUi(activeCtx, stopped);
				activeCtx.ui.notify(goalStoppedMessage(stopped), "info");
				return;
			}
			state = afterTurn;
			await saveGoal(activeCtx.cwd, state);
			await refreshUi(activeCtx, state);
		}
	}

	pi.registerCommand("goal", {
		description: "Manage a bounded project goal",
		handler: async (args, ctx) => {
			const parsed = parseCommand(args);
			if (parsed.action === "help") {
				showGoalHelp();
				await refreshUi(ctx);
				return;
			}

			if (parsed.action === "show" || parsed.action === "status") {
				const state = await loadGoal(ctx.cwd);
				if (!state) {
					ctx.ui.notify("No active pi goal. Use /goal help to see available commands.", "info");
					await refreshUi(ctx, null);
					showGoalHelp();
					return;
				}
				await showGoal(ctx, state);
				await refreshUi(ctx, state);
				return;
			}

			if (parsed.action === "file") {
				const file = parseFileGoal(parsed.rest);
				if (!file.path) {
					ctx.ui.notify("Usage: /goal file <path> [goal start|--until-complete]", "warning");
					return;
				}
				if (file.untilComplete && !(await startAllowed(ctx))) return;
				const state = file.untilComplete
					? await createFileTodoGoal(ctx.cwd, file.path)
					: createFileGoal(ctx.cwd, file.path);
				const next = file.untilComplete ? startRun(state, UNTIL_COMPLETE_TURNS) : state;
				runtime.stopRequested = false;
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				if (file.untilComplete) {
					await runGoalLoop(ctx, next);
				}
				return;
			}

			if (parsed.action === "plan") {
				const state = await requireGoal(ctx.cwd);
				cancelContinuationPending(runtime);
				runtime.stopRequested = false;
				const milestones = parseMilestonesFromRest(parsed.rest);
				const planned = generatePlanState(
					state,
					milestones?.map((m) => ({ ...m })),
				);
				await saveGoal(ctx.cwd, planned);
				await refreshUi(ctx, planned);
				ctx.ui.notify("Plan generated. Review .pi/goal/PLAN.md, then run /goal approve or /goal run.", "info");
				try {
					await pi.sendUserMessage(buildPlanReviewPrompt(planned), { deliverAs: "followUp" });
				} catch {
					// Follow-up delivery is best-effort.
				}
				return;
			}

			if (parsed.action === "approve") {
				const state = await requireGoal(ctx.cwd);
				if (!state.planRequired) {
					ctx.ui.notify("No plan is pending approval.", "info");
					return;
				}
				cancelContinuationPending(runtime);
				const approved = approvePlan(state);
				await saveGoal(ctx.cwd, approved);
				await refreshUi(ctx, approved);
				ctx.ui.notify("Plan approved. Use /goal run to start implementation.", "info");
				return;
			}

			if (parsed.action === "goal") {
				if (!(await startAllowed(ctx))) return;
				runtime.stopRequested = false;
				const state = await createTextGoal(ctx.cwd, parsed.rest);
				const next = startRun(state, UNTIL_COMPLETE_TURNS);
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				await runGoalLoop(ctx, next);
				return;
			}

			if (parsed.action === "edit") {
				const state = await requireGoal(ctx.cwd);
				const trimmed = parsed.rest.trim();
				if (!trimmed) {
					ctx.ui.notify("Usage: /goal edit <new objective>", "warning");
					return;
				}
				cancelContinuationPending(runtime);
				const next = invalidatePlan(updateGoal(state, { objective: trimmed }));
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				ctx.ui.notify("Goal updated. The plan has been invalidated; run /goal plan to replan.", "info");
				return;
			}

			if (parsed.action === "pause") {
				const state = await requireGoal(ctx.cwd);
				cancelContinuationPending(runtime);
				runtime.stopRequested = false;
				const next = updateGoal(state, { status: "paused", runActive: false });
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				return;
			}

			if (parsed.action === "resume") {
				const state = await requireGoal(ctx.cwd);
				if (state.status === "complete") {
					ctx.ui.notify("Goal is complete; clear it before setting a new one.", "warning");
					return;
				}
				const next = updateGoal(state, { status: "active" });
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				return;
			}

			if (parsed.action === "clear") {
				cancelContinuationPending(runtime);
				runtime.stopRequested = false;
				await clearGoal(ctx.cwd);
				await refreshUi(ctx, null);
				ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
				return;
			}

			if (parsed.action === "run") {
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
				const turns = parseTurns(parsed.rest);
				const next = startRun(state, turns);
				await saveGoal(ctx.cwd, next);
				await refreshUi(ctx, next);
				await runGoalLoop(ctx, next);
				return;
			}

			if (parsed.action === "stop") {
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
				await refreshUi(ctx, stopped);
				ctx.ui.notify(goalStoppedMessage(stopped), "info");
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
			await refreshUi(ctx, null);
			ctx.ui.notify("Goal cleared: removed .pi/goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
		},
	});

	registerGoalTools(pi, runtime, refreshUi);

	pi.on("session_start", async (_event, ctx) => {
		await refreshUi(ctx);
	});

	pi.on("input", async (event) => {
		if (event.source !== "extension") return;
		if (isCancelledContinuation(runtime, event.text)) {
			return { action: "handled" };
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = await loadGoal(ctx.cwd);
		if (!state || (state.status !== "active" && state.status !== "planning")) {
			return;
		}
		return {
			message: {
				customType: "pi-goal-context",
				content: goalContextMessage(state),
				display: false,
				details: {
					goalId: state.goalId,
					runId: state.runId,
					turnsUsed: state.turnsUsed,
					turnBudget: state.turnBudget,
				},
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
				await refreshUi(ctx, paused);
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
			await refreshUi(ctx, state);
			return;
		}

		const afterTurn = updateGoal(state, { turnsUsed: state.turnsUsed + 1 });
		await writeGoalIteration(ctx.cwd, afterTurn, afterTurn.turnsUsed, event.messages as readonly unknown[]);
		if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
			const stopped = updateGoal(afterTurn, { runActive: false });
			runtime.stopRequested = false;
			await saveGoal(ctx.cwd, stopped);
			await refreshUi(ctx, stopped);
			pi.sendMessage(
				{
					customType: "pi-goal-run-stopped",
					content: goalStoppedMessage(stopped),
					display: true,
					details: stopped,
				},
				{ triggerTurn: false },
			);
			return;
		}

		await saveGoal(ctx.cwd, afterTurn);
		await refreshUi(ctx, afterTurn);
		try {
			pi.sendUserMessage(continuationPrompt(afterTurn), { deliverAs: "followUp" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const stopped = updateGoal(afterTurn, { runActive: false, lastError: message });
			await saveGoal(ctx.cwd, stopped);
			await refreshUi(ctx, stopped);
			ctx.ui.notify(`Goal continuation fell back to single-run mode: ${message}`, "warning");
		}
	});
}

function getGoalRuntime(): GoalRuntime {
	const globals = globalThis as Record<symbol, unknown>;
	if (!globals[GOAL_RUNTIME_KEY]) {
		globals[GOAL_RUNTIME_KEY] = {
			resolve: null,
			stopRequested: false,
			pendingMarker: null,
			cancelledMarkers: new Set<string>(),
		} satisfies GoalRuntime;
	}
	return globals[GOAL_RUNTIME_KEY] as GoalRuntime;
}

function cancelContinuationPending(runtime: GoalRuntime): void {
	if (runtime.pendingMarker) {
		runtime.cancelledMarkers.add(runtime.pendingMarker);
		while (runtime.cancelledMarkers.size > MAX_CANCELLED_MARKERS) {
			const first = runtime.cancelledMarkers.values().next().value as string;
			runtime.cancelledMarkers.delete(first);
		}
		runtime.pendingMarker = null;
	}
}

function isCancelledContinuation(runtime: GoalRuntime, prompt: string): boolean {
	const marker = extractContinuationMarker(prompt);
	return marker !== undefined && runtime.cancelledMarkers.has(marker);
}

function findFinalAssistantMessage(messages: readonly unknown[]): { role: string; stopReason?: string; errorMessage?: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || typeof m !== "object") continue;
		const c = m as Record<string, unknown>;
		if (c.role !== "assistant") continue;
		return {
			role: "assistant",
			stopReason: typeof c.stopReason === "string" ? c.stopReason : undefined,
			errorMessage: typeof c.errorMessage === "string" ? c.errorMessage : undefined,
		};
	}
	return undefined;
}

function buildPlanReviewPrompt(state: GoalState): string {
	const milestoneList = state.milestones
		.map((m, i) => `${i + 1}. ${m.title}\n   Validate: \`${m.validationCommand}\``)
		.join("\n");
	return `A reviewable plan has been generated for this goal.\n\n${milestoneList}\n\nReview or edit .pi/goal/PLAN.md, then run /goal approve or /goal run to start implementation.`;
}

function parseMilestonesFromRest(rest: string): { id: string; title: string; validationCommand: string; status: "pending" }[] | undefined {
	const trimmed = rest.trim();
	if (!trimmed) return undefined;
	const lines = trimmed.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
	return lines.map((line, index) => ({
		id: `m-${index + 1}`,
		title: line,
		validationCommand: "npm run check && npm test",
		status: "pending" as const,
	}));
}

function goalStoppedMessage(state: GoalState): string {
	const reason = state.turnsUsed >= state.turnBudget ? "turn budget reached" : "stop requested";
	return `Goal run stopped after ${state.turnsUsed}/${state.turnBudget} turns (${reason}). Use /goal run --turns N to continue.`;
}

function goalHelpText(): string {
	return ["# pi-goal commands", "", ...GOAL_HELP_COMMANDS.map((command) => `- ${command}`)].join("\n");
}

interface ParsedCommand {
	readonly action: string;
	readonly rest: string;
}

interface FileGoalArgs {
	readonly path: string;
	readonly untilComplete: boolean;
}

function parseCommand(args: string): ParsedCommand {
	const trimmed = args.trim();
	if (!trimmed) {
		return { action: "help", rest: "" };
	}
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	const action = match?.[1] ?? "show";
	const rest = match?.[2] ?? "";
	if (KNOWN_ACTIONS.has(action)) {
		return { action, rest };
	}
	if (action.startsWith("-")) {
		return { action: "unknown", rest: rest ? `${action} ${rest}` : action };
	}
	return { action: "goal", rest: rest ? `${action} ${rest}` : action };
}

function parseFileGoal(args: string): FileGoalArgs {
	const untilComplete = /(?:^|\s)(?:--until-complete|(?:goal\s+)?start)(?:\s|$)/.test(args);
	const path = args.replace(/(?:^|\s)(?:--until-complete|(?:goal\s+)?start)(?:\s|$)/g, " ").trim();
	return { path, untilComplete };
}

function parseTurns(args: string): number {
	if (!args.trim()) {
		return DEFAULT_TURNS;
	}
	if (/(?:^|\s)--until-complete(?:\s|$)/.test(args)) {
		return UNTIL_COMPLETE_TURNS;
	}
	const match = args.match(/(?:^|\s)--turns(?:=|\s+)(\d+)(?:\s|$)/);
	if (!match) {
		throw new Error("Usage: /goal run --turns N or /goal run --until-complete");
	}
	const value = Number(match[1]);
	if (!Number.isInteger(value) || value < 1 || value > 20) {
		throw new Error("--turns must be an integer from 1 to 20");
	}
	return value;
}

async function requireGoal(cwd: string): Promise<GoalState> {
	const state = await loadGoal(cwd);
	if (!state) {
		throw new Error("No pi goal is set. Use /goal file <path> first.");
	}
	return state;
}
