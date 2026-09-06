/**
 * Shared pi-goal command and parsing helpers.
 */
import { createGoalSessionScope, type GoalSessionScope } from "./goal-binding.js";
import { loadGoal } from "./goal-persist.js";
import type { GoalState } from "./goal-types.js";

export function goalScopeForContext(
	ctx: { readonly cwd: string; readonly sessionManager?: unknown },
	appendBinding?: (goalId: string | null) => void | Promise<void>,
): GoalSessionScope {
	return createGoalSessionScope(ctx, appendBinding);
}

export const UNBOUNDED_TURN_BUDGET = 0;

const KNOWN_ACTIONS = new Set([
	"show",
	"status",
	"help",
	"file",
	"pause",
	"resume",
	"clear",
	"run",
	"stop",
	"steer",
	"edit",
]);

export const GOAL_HELP_COMMANDS = [
	"/goal help — show this command summary",
	"/goal status — show the current goal",
	"/goal <text> — create a text goal and run until completion",
	"/goal file <path> — create a file-backed goal and run until completion",
	"/goal run [--turns N] — resume until completion (or set an explicit bounded turn count)",
	"/goal pause | resume | stop — manage the current goal run",
	"/goal steer <text> — send untrusted guidance to the current run",
	"/goal edit <text> — update the objective of the active goal",
	"/goal clear — remove .pi/goal/ state and local run artifacts for this workspace",
] as const;

/** Parsed /goal command structure. */
interface ParsedCommand {
	readonly action: string;
	readonly rest: string;
}

/** Parsed /goal file arguments. */
interface FileGoalArgs {
	readonly path: string;
	readonly untilComplete: boolean;
}

/** Parse a /goal command line into action and remainder. */
export function parseCommand(args: string): ParsedCommand {
	const trimmed = args.trim();
	if (!trimmed) {
		return { action: "help", rest: "" };
	}
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	const action = match?.[1] ?? "show";
	const rest = match?.[2] ?? "";
	if (action === "continue" && !rest) {
		return { action: "resume", rest };
	}
	if (KNOWN_ACTIONS.has(action)) {
		return { action, rest };
	}
	if (action.startsWith("-")) {
		return { action: "unknown", rest: rest ? `${action} ${rest}` : action };
	}
	return { action: "goal", rest: rest ? `${action} ${rest}` : action };
}

/** Parse `/goal file <path> [start|--until-complete]` arguments. */
export function parseFileGoal(args: string): FileGoalArgs {
	const untilComplete = /(?:^|\s)(?:--until-complete|--continuous|(?:goal\s+)?start)(?:\s|$)/.test(args);
	const path = args.replace(/(?:^|\s)(?:--until-complete|--continuous|(?:goal\s+)?start)(?:\s|$)/g, " ").trim();
	return { path, untilComplete };
}

export function stripRunMode(args: string): string {
	return args.replace(/(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/g, " ").trim();
}

/** Parse run turn options. */
export function parseTurns(args: string): number {
	if (!args.trim() || /(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/.test(args)) {
		return UNBOUNDED_TURN_BUDGET;
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

/** Throw if no goal is active for this workspace. */
export async function requireGoal(cwd: string, scope?: GoalSessionScope): Promise<GoalState> {
	const state = await loadGoal(cwd, scope);
	if (!state) {
		throw new Error("No pi goal is set. Use /goal file <path> first.");
	}
	return state;
}

/** Render the /goal help text. */
export function goalHelpText(): string {
	return ["# pi-goal commands", "", ...GOAL_HELP_COMMANDS.map((command) => `- ${command}`)].join("\n");
}

/** Human-readable message when a goal run stops. */
export function goalStoppedMessage(state: GoalState): string {
	const bounded = state.turnBudget > 0;
	const reason = bounded && state.turnsUsed >= state.turnBudget ? "turn budget reached" : "stop requested";
	const progress = bounded ? `${state.turnsUsed}/${state.turnBudget}` : `${state.turnsUsed}`;
	return `Goal run stopped after ${progress} turns (${reason}). Use /goal run to continue (or --turns N for a bounded run).`;
}

export function collectChangedFiles(messages: readonly unknown[], existing: readonly string[] = []): readonly string[] {
	const files = new Set(existing.filter((file) => file.length > 0).map((file) => file.slice(0, 160)));
	for (const message of messages) {
		if (!isRecord(message) || message.role !== "toolResult" || !isRecord(message.details)) continue;
		const details = message.details;
		for (const key of ["path", "filePath"]) {
			if (typeof details[key] === "string") files.add(details[key].slice(0, 160));
		}
		for (const key of ["files", "changedFiles", "modifiedFiles"]) {
			const values = details[key];
			if (Array.isArray(values)) {
				for (const value of values) {
					if (typeof value === "string" && value.length > 0) files.add(value.slice(0, 160));
				}
			}
		}
	}
	return [...files].slice(-20);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
