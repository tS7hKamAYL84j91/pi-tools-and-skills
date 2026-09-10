/**
 * Shared board action transactions: the single guard implementation for
 * tools and the TUI overlay. Only board-transactions.ts appends to
 * board.log; these operations run inside its locked transactions.
 */

import { runGateCommand } from "../../lib/gate-command.js";
import { formatChecks } from "./board-event-handlers.js";
import {
	type BoardState,
	escapeLogValue,
	getTask,
	nowZ,
	PRIORITY_ORDER,
	sanitiseAgent,
	type TaskState,
	type TaskVerificationCheck,
	validateTaskId,
	WIP_LIMIT,
	writeTaskFile,
} from "./board.js";
import { withBoardTransaction } from "./board-transactions.js";

// ── Claim ─────────────────────────────────────────────────────

export type ClaimOutcome =
	| {
			status: "claimed";
			taskId: string;
			title: string;
			priority: string;
			tags: string;
			expires: string;
	  }
	| {
			status: "reassigned";
			taskId: string;
			oldAgent: string;
			newAgent: string;
			expires: string;
	  }
	| { status: "task-not-found"; taskId: string }
	| { status: "wrong-column"; taskId: string; col: string }
	| { status: "in-progress-owner"; taskId: string; owner: string }
	| { status: "wip-limit"; taskId: string; wip: number }
	| { status: "no-task" };

interface ClaimOptions {
	/** Refuse to reassign an in-progress task (overlay policy). Tools may reassign. */
	claimOnly?: boolean;
}

/**
 * Claim a specific or auto-picked todo task under the board lock.
 * Default policy reassigns an in-progress target (UNCLAIM+CLAIM, no
 * compensating appends); `claimOnly` refuses stale-view reassignment so a
 * cached selection can never steal a task another actor claimed meanwhile.
 */
export async function claimTask(
	agent: string,
	targetTaskId?: string,
	model?: string,
	options: ClaimOptions = {},
): Promise<ClaimOutcome> {
	return withBoardTransaction((board) => {
		const modelSuffix = model ? ` model=${model}` : "";
		let taskId = targetTaskId;
		let reassigningFrom = "";

		if (taskId) {
			validateTaskId(taskId);
			const task = board.tasks.get(taskId);
			if (!task || task.deleted) {
				return {
					events: [],
					result: { status: "task-not-found", taskId } as ClaimOutcome,
				};
			}
			if (task.col === "in-progress") {
				if (options.claimOnly) {
					return {
						events: [],
						result: {
							status: "in-progress-owner",
							taskId,
							owner: task.claimAgent || "nobody",
						} as ClaimOutcome,
					};
				}
				reassigningFrom = task.claimAgent || "unknown";
			} else if (task.col !== "todo") {
					return {
						events: [],
						result: {
							status: "wrong-column",
							taskId,
							col: task.col,
						} as ClaimOutcome,
					};
			}
		} else {
			let bestId = "";
			let bestPriority = 99;
			for (const candidateId of board.order) {
				const candidate = board.tasks.get(candidateId);
				if (!candidate || candidate.col !== "todo" || candidate.claimed) {
					continue;
				}
				const priority = PRIORITY_ORDER[candidate.priority] ?? 99;
				if (
					priority < bestPriority ||
					(priority === bestPriority &&
						parseInt(candidateId.slice(2), 10) < parseInt(bestId.slice(2), 10))
				) {
					bestPriority = priority;
					bestId = candidateId;
				}
			}
			if (!bestId) {
				return {
					events: [],
						result: { status: "no-task" } as ClaimOutcome,
					};
			}
			taskId = bestId;
		}

		if (!reassigningFrom) {
			const wip = [...board.tasks.values()].filter(
				(task) => task.col === "in-progress",
			).length;
			if (wip >= WIP_LIMIT) {
				return {
					events: [],
					result: {
							status: "wip-limit",
							taskId: taskId as string,
							wip,
						} as ClaimOutcome,
					};
			}
		}

		const timestamp = nowZ();
		const expires = new Date(Date.now() + 7_200_000).toISOString();
		const safeAgent = sanitiseAgent(agent);
		if (reassigningFrom) {
			return {
					events: [
					`${timestamp} UNCLAIM ${taskId} ${sanitiseAgent(reassigningFrom)}`,
					`${timestamp} CLAIM ${taskId} ${safeAgent} expires=${expires}${modelSuffix}`,
				],
				result: {
					status: "reassigned",
					taskId: taskId as string,
					oldAgent: reassigningFrom,
					newAgent: agent,
					expires,
				} as ClaimOutcome,
			};
		}

		const task = board.tasks.get(taskId);
		const fromColumn = task?.col ?? "todo";
		return {
			events: [
				`${timestamp} CLAIM ${taskId} ${safeAgent} expires=${expires}${modelSuffix}`,
				`${timestamp} MOVE ${taskId} ${safeAgent} from=${fromColumn} to=in-progress`,
			],
			result: {
				status: "claimed",
					taskId: taskId as string,
					title: task?.title ?? "",
					priority: task?.priority ?? "medium",
					tags: task?.tags ?? "",
					expires,
			} as ClaimOutcome,
			};
		});
}

// ── Completion orchestration ────────────────────────────────────

/** Single completion path for tools and the overlay: preflight, trusted gate, locked commit. */
export async function orchestrateTaskCompletion(
	taskId: string,
	agent: string,
	options: {
		duration?: string;
		checks?: TaskVerificationCheck[];
		cwd: string;
		signal?: AbortSignal;
	},
): Promise<void> {
	const checks = options.checks ?? [];
	const task = await getTask(taskId);
	validateTaskComplete(task, taskId, agent, checks);
	const gateCommand = process.env.KANBAN_GATE_COMMAND;
	if (gateCommand !== undefined) {
		const gate = await runGateCommand(gateCommand, options.cwd, options.signal);
		if (!gate.passed) {
			throw new Error(
				`kanban_complete gate failed for ${taskId} (exitCode=${gate.exitCode}): ${gate.stderrSummary || gate.stdoutSummary}`,
			);
		}
	}
	// Cancellation checkpoint: an aborted caller must not commit a completion.
	options.signal?.throwIfAborted();
	await completeTask(taskId, agent, {
		duration: options.duration,
		checks,
	});
}

// ── Verification ────────────────────────────────────────────────
function taskRequiresVerification(
	task: TaskState,
	explicitChecks?: TaskVerificationCheck[],
): boolean {
	return (
		task.verificationRequired ||
		process.env.KANBAN_REQUIRE_CHECK_EVIDENCE === "1" ||
		Boolean(explicitChecks?.length)
	);
}

/** Same completion preconditions the tool enforces; throws with the tool's messages. */
function validateTaskComplete(
	task: TaskState,
	taskId: string,
	agent: string,
	checks: TaskVerificationCheck[],
): void {
	if (task.col !== "in-progress") {
		throw new Error(`Task ${taskId} is not in-progress (col=${task.col})`);
	}
	if (task.claimAgent !== sanitiseAgent(agent)) {
		throw new Error(
			`Agent ${agent} is not the claimed owner of ${taskId} (claimed by ${task.claimAgent || "nobody"})`,
		);
	}
	const passing =
		checks.length > 0 && checks.every((check) => check.exitCode === 0);
	if (taskRequiresVerification(task, checks) && !passing) {
		throw new Error(
			`Task ${taskId} requires verification evidence with all exit_code=0 before completion`,
		);
	}
}

function completeLogLine(inputs: {
	timestamp: string;
	taskId: string;
	agent: string;
	duration: string;
	needsVerification: boolean;
	checks: TaskVerificationCheck[];
}): string {
	const verificationPayload = inputs.needsVerification
		? " verification_required=true"
		: "";
	const checkPayload =
		inputs.checks.length > 0
			? ` checks="${escapeLogValue(formatChecks(inputs.checks))}"`
			: "";
	return `${inputs.timestamp} COMPLETE ${inputs.taskId} ${sanitiseAgent(inputs.agent)} duration=${inputs.duration}${verificationPayload}${checkPayload}`;
}

/** Append the COMPLETE + done-move events after re-validating under the lock. */
async function completeTask(
	taskId: string,
	agent: string,
	options: { duration?: string; checks?: TaskVerificationCheck[] } = {},
): Promise<void> {
	const duration = options.duration ?? "unknown";
	const checks = options.checks ?? [];
	await withBoardTransaction((board) => {
		const task = board.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}
		validateTaskComplete(task, taskId, agent, checks);
		const needsVerification = taskRequiresVerification(task, checks);
		const timestamp = nowZ();
		return {
			events: [
				completeLogLine({
					timestamp,
					taskId,
					agent,
					duration,
					needsVerification,
					checks,
				}),
				`${timestamp} MOVE ${taskId} ${sanitiseAgent(agent)} from=in-progress to=done`,
			],
			result: undefined,
		};
	});
}

/** Append BLOCK + blocked-move events for an in-progress task. */
export async function blockTask(
	taskId: string,
	agent: string,
	reason: string,
): Promise<void> {
	await withBoardTransaction((board) => {
		const task = board.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}
		if (task.col !== "in-progress") {
			throw new Error(`Task ${taskId} is not in-progress (col=${task.col})`);
		}
		const timestamp = nowZ();
		const safeAgent = sanitiseAgent(agent);
		return {
			events: [
				`${timestamp} BLOCK ${taskId} ${safeAgent} reason="${escapeLogValue(reason)}"`,
				`${timestamp} MOVE ${taskId} ${safeAgent} from=in-progress to=blocked`,
			],
			result: undefined,
		};
	});
}

/** Append UNBLOCK + todo-move events for a blocked task. */
export async function unblockTask(
	taskId: string,
	agent: string,
	resolution: string,
): Promise<void> {
	await withBoardTransaction((board) => {
		const task = board.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task ${taskId} not found`);
		}
		if (task.col !== "blocked") {
			throw new Error(
				`Task ${taskId} is in '${task.col}' column, not 'blocked'. Cannot unblock.`,
			);
		}
		const timestamp = nowZ();
		const safeAgent = sanitiseAgent(agent);
		return {
			events: [
				`${timestamp} UNBLOCK ${taskId} ${safeAgent} resolution="${escapeLogValue(resolution)}"`,
				`${timestamp} MOVE ${taskId} ${safeAgent} from=blocked to=todo`,
			],
			result: undefined,
		};
	});
}

/** Next free T-NNN id, one above the current highest numeric id. */
function nextTaskId(board: BoardState): string {
	let max = 0;
	for (const taskId of board.order) {
		const numeric = parseInt(taskId.slice(2), 10);
		if (Number.isFinite(numeric) && numeric > max) max = numeric;
	}
	return `T-${String(max + 1).padStart(3, "0")}`;
}

/** Create a task in backlog. See finishTaskFile for the durability boundary. */
interface CreateTaskResult {
	taskId: string;
	/** Present when the board.log event was appended but the task file could not be written. */
	fileWarning?: string;
}

interface CreateTaskInput {
	taskId?: string;
	agent: string;
	title: string;
	priority: string;
	tags?: string;
	description?: string;
}

function createEventLine(taskId: string, input: CreateTaskInput): string {
	const descPart = input.description
		? ` description="${escapeLogValue(input.description)}"`
		: "";
	return `${nowZ()} CREATE ${taskId} ${sanitiseAgent(input.agent)} title="${escapeLogValue(input.title)}" priority="${input.priority}" tags="${escapeLogValue(input.tags ?? "")}"${descPart}`;
}

/**
 * The board.log event is appended under the board lock; the Markdown task
 * file is written after the lock is released. A file-write failure is a
 * partial success: the task exists in the authoritative log and creation
 * must not be retried with a new id.
 */
async function finishTaskFile(
	taskId: string,
	input: CreateTaskInput,
): Promise<CreateTaskResult> {
	try {
		await writeTaskFile(taskId, {
			title: input.title,
			description: input.description ?? "",
			priority: input.priority,
			tags: input.tags ?? "",
			agent: input.agent,
		});
	} catch (error) {
		const fileWarning =
			error instanceof Error ? error.message : String(error);
		return { taskId, fileWarning };
	}
	return { taskId };
}

/** Create a task with an explicit id; the id must not already exist. */
export async function createTask(input: {
	taskId: string;
	agent: string;
	title: string;
	priority: string;
	tags?: string;
	description?: string;
}): Promise<CreateTaskResult> {
	const { taskId } = await withBoardTransaction((board) => {
		validateTaskId(input.taskId);
		if (board.tasks.has(input.taskId)) {
			throw new Error(`Task ID ${input.taskId} already exists`);
		}
		return {
			events: [createEventLine(input.taskId, input)],
			result: { taskId: input.taskId },
		};
	});
	return finishTaskFile(taskId, input);
}

/** Create a task with the next free id, allocated under the board lock. */
export async function createTaskWithNextId(
	input: Omit<CreateTaskInput, "taskId">,
): Promise<CreateTaskResult> {
	const { taskId } = await withBoardTransaction((board) => {
		const taskId = nextTaskId(board);
		return {
			events: [createEventLine(taskId, input)],
			result: { taskId },
		};
	});
	return finishTaskFile(taskId, input);
}