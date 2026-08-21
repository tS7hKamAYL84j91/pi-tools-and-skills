/**
 * Shared pi-goal command and parsing helpers.
 */
import { createGoalSessionScope, type GoalSessionScope } from "./goal-binding.js";
import { loadGoal } from "./goal-persist.js";
import type { GoalRunMode, GoalState } from "./goal-types.js";

export function goalScopeForContext(
	ctx: { readonly cwd: string; readonly sessionManager?: unknown },
	appendBinding?: (goalId: string | null) => void | Promise<void>,
): GoalSessionScope {
	return createGoalSessionScope(ctx, appendBinding);
}

const DEFAULT_TURNS = 3;
export const UNTIL_COMPLETE_TURNS = 20;

const KNOWN_ACTIONS = new Set([
	"show",
	"status",
	"help",
	"file",
	"plan",
	"approve",
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
	"/goal <text> [--continuous|--until-complete] — create a text goal and start a bounded run",
	"/goal file <path> [goal start|--continuous|--until-complete] — create a file-backed goal",
	"/goal plan [milestone title] — generate a reviewable plan and pause for approval",
	"/goal approve — accept the generated plan and allow implementation",
	"/goal run [--turns N|--until-complete] — continue an active or paused goal",
	"/goal pause | resume | stop — manage the current goal run",
	"/goal steer <text> — send untrusted guidance to the current run",
	"/goal edit <text> — update the objective of the active goal (invalidates the plan)",
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

export function parseRunMode(args: string): GoalRunMode {
	return /(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/.test(args) ? "continuous" : "manual";
}

export function stripRunMode(args: string): string {
	return args.replace(/(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/g, " ").trim();
}

/** Parse run turn options. */
export function parseTurns(args: string): number {
	if (!args.trim()) {
		return DEFAULT_TURNS;
	}
	if (/(?:^|\s)(?:--until-complete|--continuous)(?:\s|$)/.test(args)) {
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

/** Parse milestone titles from raw command rest. */
export function parseMilestonesFromRest(
	rest: string,
): { id: string; title: string; validationCommand: string; status: "pending" }[] | undefined {
	const trimmed = rest.trim();
	if (!trimmed) return undefined;
	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	return lines.map((line, index) => ({
		id: `m-${index + 1}`,
		title: line,
		validationCommand: "npm run check && npm test",
		status: "pending" as const,
	}));
}

/** Render a plan-review prompt from generated milestones. */
export function buildPlanReviewPrompt(state: GoalState): string {
	const milestoneList = state.milestones
		.map((m, i) => `${i + 1}. ${m.title}\n   Validate: \`${m.validationCommand}\``)
		.join("\n");
	return `A reviewable plan has been generated for this goal.\n\n${milestoneList}\n\nReview or edit .pi/goal/instances/<goalId>/PLAN.md, then run /goal approve or /goal run to start implementation.`;
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
	const reason = state.turnsUsed >= state.turnBudget ? "turn budget reached" : "stop requested";
	return `Goal run stopped after ${state.turnsUsed}/${state.turnBudget} turns (${reason}). Use /goal run --turns N to continue.`;
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
