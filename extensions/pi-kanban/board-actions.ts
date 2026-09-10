/**
 * Shared board action transactions for non-claim mutations.
 *
 * Both the tools and the TUI overlay call these so guards, event formats,
 * and completion gates have exactly one implementation. Claim handling lives
 * in claim-tools.ts next to its conflict policy.
 */

import { formatChecks } from "./board-event-handlers.js";
import {
	type BoardState,
	escapeLogValue,
	nowZ,
	sanitiseAgent,
	type TaskState,
	type TaskVerificationCheck,
	validateTaskId,
	writeTaskFile,
} from "./board.js";
import { withBoardTransaction } from "./board-transactions.js";

/** True when completion requires passing check evidence (task flag, env, or explicit checks). */
export function taskRequiresVerification(
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
export function validateTaskComplete(
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
export async function completeTask(
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
export function nextTaskId(board: BoardState): string {
	let max = 0;
	for (const taskId of board.order) {
		const numeric = parseInt(taskId.slice(2), 10);
		if (Number.isFinite(numeric) && numeric > max) max = numeric;
	}
	return `T-${String(max + 1).padStart(3, "0")}`;
}

/** Create a task in backlog: log event plus task file, atomically under the lock. */
export async function createTask(input: {
	taskId: string;
	agent: string;
	title: string;
	priority: string;
	tags?: string;
	description?: string;
}): Promise<void> {
	const { taskId, agent, title, priority } = input;
	const tags = input.tags ?? "";
	const description = input.description ?? "";
	validateTaskId(taskId);
	await withBoardTransaction((board) => {
		if (board.tasks.has(taskId)) {
			throw new Error(`Task ID ${taskId} already exists`);
		}
		const descPart = description
			? ` description="${escapeLogValue(description)}"`
			: "";
		return {
			events: [
				`${nowZ()} CREATE ${taskId} ${sanitiseAgent(agent)} title="${escapeLogValue(title)}" priority="${priority}" tags="${escapeLogValue(tags)}"${descPart}`,
			],
			result: undefined,
		};
	});
	await writeTaskFile(taskId, {
		title,
		description,
		priority,
		tags,
		agent,
	});
}