/**
 * Registers the pi-goal command, tools, lifecycle hooks, and UI status.
 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok } from "../../lib/tool-result.js";
import { continuationPrompt, goalContextMessage, kickoffPrompt } from "./prompts.js";
import {
	clearGoal,
	createFileGoal,
	createFileTodoGoal,
	createTextGoal,
	loadGoal,
	renderGoalSummary,
	saveGoal,
	startRun,
	updateGoal,
	writeGoalIteration,
	type GoalState,
} from "./state.js";

const DEFAULT_TURNS = 3;
const UNTIL_COMPLETE_TURNS = 20;
const GOAL_HELP_COMMANDS = [
	"/goal help — show this command summary",
	"/goal status — show the current goal",
	"/goal <text> — create a text goal and start a bounded run",
	"/goal file <path> [goal start|--until-complete] — create a file-backed goal",
	"/goal run [--turns N|--until-complete] — continue an active or paused goal",
	"/goal pause | resume | stop — manage the current goal run",
	"/goal clear — remove .pi-goal/ state and local run artifacts for this workspace",
] as const;
const KNOWN_ACTIONS = new Set(["show", "status", "help", "file", "pause", "resume", "clear", "run", "stop"]);
const GOAL_RUNTIME_KEY = Symbol.for("pi-goal.runtime");

export default function goalExtension(pi: ExtensionAPI): void {
	const runtime = getGoalRuntime();

	async function refreshUi(ctx: ExtensionContext, state?: GoalState | null): Promise<void> {
		const current = state === undefined ? await loadGoal(ctx.cwd) : state;
		if (!current) {
			ctx.ui.setStatus("goal", undefined);
			ctx.ui.setWidget("goal", undefined);
			return;
		}
		const stop = runtime.stopRequested ? " stopping" : "";
		const run = current.runActive ? ` ${current.turnsUsed}/${current.turnBudget}${stop}` : "";
		ctx.ui.setStatus("goal", `goal: ${current.status}${run}`);
		if (current.status === "active") {
			ctx.ui.setWidget("goal", compactWidget(current));
		} else {
			ctx.ui.setWidget("goal", undefined);
		}
	}

	function showGoal(state: GoalState): void {
		pi.sendMessage(
			{
				customType: "pi-goal-status",
				content: renderGoalSummary(state),
				display: true,
				details: state,
			},
			{ triggerTurn: false },
		);
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
		let activeCtx: ExtensionCommandContext = ctx;
		let state = initialState;
		await activeCtx.waitForIdle();
		const originalSession = activeCtx.sessionManager.getSessionFile();

		while (state.runActive && state.status === "active" && state.turnsUsed < state.turnBudget) {
			if (runtime.stopRequested) break;
			const iteration = state.turnsUsed + 1;
			const prompt = iteration === 1 ? kickoffPrompt(state) : continuationPrompt(state);
			const agentDone = new Promise<readonly unknown[]>((resolve) => {
				runtime.resolve = resolve;
			});
			activeCtx.ui.setStatus("goal", `goal: active ${state.turnsUsed}/${state.turnBudget} fresh-session`);
			const result = await activeCtx.newSession({
				...(originalSession ? { parentSession: originalSession } : {}),
				withSession: async (replacementCtx) => {
					activeCtx = replacementCtx;
					await replacementCtx.sendUserMessage(prompt);
				},
			});
			if (result.cancelled) {
				runtime.resolve = null;
				return;
			}
			const messages = await agentDone;
			const latest = await loadGoal(activeCtx.cwd);
			if (!latest || latest.status !== "active" || !latest.runActive) {
				runtime.resolve = null;
				runtime.stopRequested = false;
				await refreshUi(activeCtx, latest);
				return;
			}
			const afterTurn = updateGoal(latest, { turnsUsed: latest.turnsUsed + 1 });
			await writeGoalIteration(activeCtx.cwd, afterTurn, afterTurn.turnsUsed, messages);
			if (afterTurn.turnsUsed >= afterTurn.turnBudget || runtime.stopRequested) {
				const stopped = updateGoal(afterTurn, { runActive: false });
				runtime.resolve = null;
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
				showGoal(state);
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
				showGoal(next);
				await refreshUi(ctx, next);
				if (file.untilComplete) {
					await runGoalLoop(ctx, next);
				}
				return;
			}

			if (parsed.action === "goal") {
				if (!(await startAllowed(ctx))) return;
				runtime.stopRequested = false;
				const state = await createTextGoal(ctx.cwd, parsed.rest);
				const next = startRun(state, UNTIL_COMPLETE_TURNS);
				await saveGoal(ctx.cwd, next);
				showGoal(next);
				await refreshUi(ctx, next);
				await runGoalLoop(ctx, next);
				return;
			}

			if (parsed.action === "pause") {
				const state = await requireGoal(ctx.cwd);
				runtime.stopRequested = false;
				const next = updateGoal(state, { status: "paused", runActive: false });
				await saveGoal(ctx.cwd, next);
				showGoal(next);
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
				showGoal(next);
				await refreshUi(ctx, next);
				return;
			}

			if (parsed.action === "clear") {
				runtime.stopRequested = false;
				await clearGoal(ctx.cwd);
				await refreshUi(ctx, null);
				ctx.ui.notify("Goal cleared: removed .pi-goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
				return;
			}

			if (parsed.action === "run") {
				if (!(await startAllowed(ctx))) return;
				runtime.stopRequested = false;
				const state = await requireGoal(ctx.cwd);
				if (state.status === "complete") {
					ctx.ui.notify("Goal is already complete.", "info");
					return;
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
			runtime.stopRequested = false;
			await clearGoal(ctx.cwd);
			await refreshUi(ctx, null);
			ctx.ui.notify("Goal cleared: removed .pi-goal/ state, TODO, summary, and local run transcripts for this workspace.", "info");
		},
	});

	pi.registerTool({
		name: "goal_get",
		label: "Goal Get",
		description: "Read the current project-local pi goal state.",
		promptSnippet: "Read the active project goal, source file, run status, and completion requirements.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const state = await loadGoal(ctx.cwd);
			const details = state ? { ...state } : {};
			return ok(state ? renderGoalSummary(state) : "No pi goal is set.", details);
		},
	});

	pi.registerTool({
		name: "goal_complete",
		label: "Goal Complete",
		description: "Mark the current pi goal complete. Requires concrete evidence.",
		promptSnippet: "Mark the active project goal complete after the completion audit passes.",
		promptGuidelines: [
			"Use goal_complete only after auditing the active goal against current repository/filesystem state and include concrete evidence.",
		],
		parameters: Type.Object({
			evidence: Type.String({ description: "Concrete completion evidence and validation summary." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const evidence = params.evidence.trim();
			if (!evidence) {
				throw new Error("goal_complete requires non-empty evidence");
			}
			const state = await requireGoal(ctx.cwd);
			if (state.status !== "active") {
				throw new Error(`Cannot complete a ${state.status} goal`);
			}
			const next = updateGoal(state, {
				status: "complete",
				runActive: false,
				completionEvidence: evidence,
			});
			await saveGoal(ctx.cwd, next);
			await refreshUi(ctx, next);
			return {
				...ok(`Goal complete. Evidence: ${evidence}`, { ...next }),
				terminate: true,
			};
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await refreshUi(ctx);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = await loadGoal(ctx.cwd);
		if (!state || state.status !== "active") {
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
		if (runtime.resolve) {
			const resolve = runtime.resolve;
			runtime.resolve = null;
			resolve(event.messages as readonly unknown[]);
			return;
		}
		const state = await loadGoal(ctx.cwd);
		if (!state || state.status !== "active" || !state.runActive) {
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

interface GoalRuntime {
	resolve: ((messages: readonly unknown[]) => void) | null;
	stopRequested: boolean;
}

function getGoalRuntime(): GoalRuntime {
	const globals = globalThis as Record<symbol, unknown>;
	if (!globals[GOAL_RUNTIME_KEY]) {
		globals[GOAL_RUNTIME_KEY] = { resolve: null, stopRequested: false } satisfies GoalRuntime;
	}
	return globals[GOAL_RUNTIME_KEY] as GoalRuntime;
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

function compactWidget(state: GoalState): string[] {
	const source = state.sourcePath ? `source: ${state.sourcePath}` : "source: none";
	const run = state.runActive ? `run: ${state.turnsUsed}/${state.turnBudget}` : "run: idle";
	return [`goal: ${state.objective}`, source, run, "complete only with goal_complete evidence"];
}
