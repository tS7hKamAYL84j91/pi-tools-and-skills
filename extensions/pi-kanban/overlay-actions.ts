/**
 * Overlay board actions: thin wrappers over the shared board transactions
 * with human-oriented status messages. The controller stays free of
 * transaction logic; guards (WIP, ownership, verification, gates) are
 * enforced by the shared transaction layer, never duplicated here.
 */

import { runGateCommand } from "../../lib/gate-command.js";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	parseBoard,
	sanitiseAgent,
	type TaskState,
	WIP_LIMIT,
} from "./board.js";
import {
	blockTask,
	completeTask,
	createTask,
	nextTaskId,
	taskRequiresVerification,
	unblockTask,
} from "./board-actions.js";
import { deleteTask, moveTask } from "./board-transactions.js";
import { claimTask } from "./claim-tools.js";

/**
 * Operator identity recorded in board.log for overlay mutations. Set
 * KANBAN_OVERLAY_AGENT to attribute actions to a specific human/operator.
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

/** Claim the selected todo task, or the next eligible todo task. */
export async function claimFromOverlay(
	ui: OverlayActions,
	selected: TaskState | undefined,
): Promise<void> {
	try {
		if (selected?.col === "in-progress") {
			ui.flash(
				`Claim unavailable: in-progress (owner ${selected.claimAgent || "nobody"}) — use kanban_claim to reassign`,
			);
			return;
		}
		const outcome = await claimTask(
			ui.agent,
			selected?.col === "todo" ? selected.id : undefined,
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

/** Complete an owned in-progress task; verification and gates deny from here. */
export async function completeFromOverlay(
	ui: OverlayActions,
	task: TaskState,
): Promise<void> {
	if (task.col !== "in-progress") {
		ui.flash(`Complete unavailable: task is in ${task.col}`);
		return;
	}
	if (task.claimAgent !== ui.agent) {
		ui.flash(`Complete denied: claimed by ${task.claimAgent || "nobody"}`);
		return;
	}
	if (taskRequiresVerification(task)) {
		ui.flash(
			"Complete denied: verification evidence required (use kanban_complete with checks)",
		);
		return;
	}
	const gateCommand = process.env.KANBAN_GATE_COMMAND;
	if (gateCommand !== undefined) {
		try {
			const gate = await runGateCommand(gateCommand, ui.cwd, undefined);
			if (!gate.passed) {
				ui.flash(`Complete denied: gate failed (exit ${gate.exitCode})`);
				return;
			}
		} catch (err) {
			ui.flash(`Complete denied: gate error (${errorMessage(err)})`);
			return;
		}
	}
	try {
		await completeTask(task.id, ui.agent, { duration: "unknown" });
		ui.flash(`Completed ${task.id}`);
	} catch (err) {
		ui.flash(`Complete denied: ${errorMessage(err)}`);
	}
}

/** Create a task in backlog with the next free id (bounded id-collision retry). */
export async function createFromOverlay(
	ui: OverlayActions,
	title: string,
): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const board = await parseBoard();
			const taskId = nextTaskId(board);
			await createTask({
				taskId,
				agent: ui.agent,
				title,
				priority: "medium",
			});
			ui.flash(`Created ${taskId}: ${title} (backlog)`);
			return;
		} catch (err) {
			if (
				attempt === 2 ||
				!String(errorMessage(err)).includes("already exists")
			) {
				ui.flash(`Create failed: ${errorMessage(err)}`);
				return;
			}
		}
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

// ── Inline prompt input (shared by new-task and block-reason modes) ──

type PromptInputResult =
	| { type: "submit"; value: string }
	| { type: "cancel" }
	| { type: "edit"; buffer: string }
	| { type: "ignore" };

/** Interpret one keypress for an inline text prompt buffer. */
export function applyPromptInput(
	buffer: string,
	data: string,
): PromptInputResult {
	if (matchesKey(data, "escape")) return { type: "cancel" };
	if (matchesKey(data, "enter") || matchesKey(data, "return")) {
		return { type: "submit", value: buffer };
	}
	if (matchesKey(data, "backspace") || matchesKey(data, "delete")) {
		return { type: "edit", buffer: buffer.slice(0, -1) };
	}
	if (data.length === 1 && data >= " ") {
		return { type: "edit", buffer: buffer + data };
	}
	return { type: "ignore" };
}