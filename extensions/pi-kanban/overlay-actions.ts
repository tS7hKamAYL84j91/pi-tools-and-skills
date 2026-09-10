/**
 * Overlay board actions: thin wrappers over the shared board transactions
 * with human-oriented status messages. The controller stays free of
 * transaction logic; guards (WIP, ownership, verification, gates) are
 * enforced by the shared transaction layer, never duplicated here.
 */

import {
	sanitiseAgent,
	type TaskState,
	WIP_LIMIT,
} from "./board.js";
import {
	blockTask,
	claimTask,
	createTaskWithNextId,
	orchestrateTaskCompletion,
	unblockTask,
} from "./board-actions.js";
import { deleteTask, moveTask } from "./board-transactions.js";

/**
 * Operator identity recorded in board.log for overlay mutations. Set
 * KANBAN_OVERLAY_AGENT to attribute actions to a specific human/operator.
 * The label is not an authenticated identity; it attributes actions only.
 */
const OVERLAY_AGENT_ENV = "KANBAN_OVERLAY_AGENT";
const DEFAULT_OVERLAY_AGENT = "operator";

export function overlayAgentId(): string {
	const raw = process.env[OVERLAY_AGENT_ENV];
	return sanitiseAgent(
		typeof raw === "string" && raw.trim() ? raw : DEFAULT_OVERLAY_AGENT,
	);
}

/** What the overlay controller provides to action wrappers. */
export interface OverlayActions {
	readonly agent: string;
	readonly cwd: string;
	/** Show a transient status line; clears on the next board key. */
	flash(message: string): void;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Claim the selected todo task, or the next eligible todo task. claimOnly
 * refuses to reassign: a stale selection that another actor claimed in the
 * meantime is denied inside the locked transaction, never stolen.
 */
export async function claimFromOverlay(
	ui: OverlayActions,
	selected: TaskState | undefined,
): Promise<void> {
	try {
		const outcome = await claimTask(
			ui.agent,
			selected?.col === "todo" ? selected.id : undefined,
			undefined,
			{ claimOnly: true },
		);
		switch (outcome.status) {
			case "claimed":
				ui.flash(`Claimed ${outcome.taskId} — now in-progress`);
				break;
			case "reassigned":
				ui.flash(
					`Reassigned ${outcome.taskId}: ${outcome.oldAgent} → ${outcome.newAgent}`,
				);
				break;
			case "task-not-found":
				ui.flash(`Claim denied: task ${outcome.taskId} not found`);
				break;
			case "wrong-column":
				ui.flash(`Claim unavailable: task is in ${outcome.col}`);
				break;
			case "in-progress-owner":
				ui.flash(
					`Claim unavailable: in-progress (owner ${outcome.owner}) — use kanban_claim to reassign`,
				);
				break;
			case "wip-limit":
				ui.flash(`Claim denied: WIP limit reached (${outcome.wip}/${WIP_LIMIT})`);
				break;
			case "no-task":
				ui.flash("No todo tasks to claim");
				break;
		}
	} catch (err) {
		ui.flash(`Claim failed: ${errorMessage(err)}`);
	}
}

/**
 * Complete an owned in-progress task through the same orchestration the
 * tool uses: fresh validation, trusted gate, then the locked commit.
 * Verification-evidence and gate requirements deny from here.
 */
export async function completeFromOverlay(
	ui: OverlayActions,
	task: TaskState,
	signal?: AbortSignal,
): Promise<void> {
	try {
		await orchestrateTaskCompletion(task.id, ui.agent, {
			duration: "unknown",
			cwd: ui.cwd,
			signal,
		});
		ui.flash(`Completed ${task.id}`);
	} catch (err) {
		ui.flash(`Complete denied: ${errorMessage(err)}`);
	}
}

/** Create a task in backlog with the next id allocated under the board lock. */
export async function createFromOverlay(
	ui: OverlayActions,
	title: string,
): Promise<void> {
	try {
		const result = await createTaskWithNextId({
			agent: ui.agent,
			title,
			priority: "medium",
		});
		ui.flash(
			result.fileWarning
				? `Created ${result.taskId}: ${title} (backlog; task file write failed: ${result.fileWarning})`
				: `Created ${result.taskId}: ${title} (backlog)`,
		);
	} catch (err) {
		ui.flash(`Create failed: ${errorMessage(err)}`);
	}
}

/** Block an in-progress task with a reason. */
export async function blockFromOverlay(
	ui: OverlayActions,
	task: TaskState,
	reason: string,
): Promise<void> {
	if (task.col !== "in-progress") {
		ui.flash(`Block unavailable: task is in ${task.col}`);
		return;
	}
	try {
		await blockTask(task.id, ui.agent, reason);
		ui.flash(`Blocked ${task.id}: ${reason}`);
	} catch (err) {
		ui.flash(`Block failed: ${errorMessage(err)}`);
	}
}

/** Unblock a blocked task back to todo. */
export async function unblockFromOverlay(
	ui: OverlayActions,
	task: TaskState,
): Promise<void> {
	if (task.col !== "blocked") {
		ui.flash(`Unblock unavailable: task is in ${task.col}`);
		return;
	}
	try {
		await unblockTask(task.id, ui.agent, "");
		ui.flash(`Unblocked ${task.id} — back in todo`);
	} catch (err) {
		ui.flash(`Unblock failed: ${errorMessage(err)}`);
	}
}

/** Delete a non-in-progress task after explicit confirmation. */
export async function deleteFromOverlay(
	ui: OverlayActions,
	task: TaskState,
): Promise<void> {
	try {
		await deleteTask(task.id, ui.agent);
		ui.flash(`Deleted ${task.id}`);
	} catch (err) {
		ui.flash(`Delete failed: ${errorMessage(err)}`);
	}
}

/** Move a backlog/todo task; moving to the current column is a no-op. */
export async function moveFromOverlay(
	ui: OverlayActions,
	task: TaskState,
	to: "backlog" | "todo",
): Promise<void> {
	if (task.col === to) {
		ui.flash(`Already in ${to}`);
		return;
	}
	try {
		await moveTask(task.id, ui.agent, to);
		ui.flash(`Moved ${task.id} → ${to}`);
	} catch (err) {
		ui.flash(`Move failed: ${errorMessage(err)}`);
	}
}