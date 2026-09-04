/** Session-local FIFO command queue: dedupe, bounds, lifecycle transitions (SPEC §10, §11, §13). */

import type { TodoProjection } from "./projector.js";
import {
	type AutomationSpec,
	type CommandRecord,
	deriveCommandId,
	type LimitsConfig,
	type ProfileConfig,
	type TodoItem,
} from "./types.js";

/** Outcome of offering one command to the queue. */
type EnqueueOutcome =
	| {
			readonly ok: true;
			readonly queue: readonly CommandRecord[];
			readonly record: CommandRecord;
			readonly duplicate: boolean;
	  }
	| {
			readonly ok: false;
			readonly queue: readonly CommandRecord[];
			readonly reason: string;
	  };

/**
 * Build the deterministic command record for one automation × work item (SPEC §10).
 * Config validation guarantees the automation's issue command exists; the return type
 * stays honest for replay robustness.
 */
export function buildCommandRecord(
	profileName: string,
	profile: ProfileConfig,
	automation: AutomationSpec,
	item: TodoItem,
): CommandRecord | undefined {
	const spec = profile.commands[automation.issue];
	if (spec === undefined) {
		return undefined;
	}
	return {
		commandId: deriveCommandId(profileName, automation.id, item.workItemId),
		type: automation.issue,
		automationId: automation.id,
		workItemId: item.workItemId,
		viewId: item.viewId,
		correlationId: item.key,
		causedBy: item.openedByEventId,
		message: spec.message,
		expectedEvents: spec.expectedEvents,
		workItem: item.sourcePayload,
		status: "queued",
	};
}

/**
 * Offer a command to the FIFO queue. Duplicates (same stable command ID) are ignored;
 * the queue is bounded by maxPendingCommands (SPEC §11, §14).
 */
export function enqueueCommand(
	queue: readonly CommandRecord[],
	record: CommandRecord,
	limits: LimitsConfig,
): EnqueueOutcome {
	if (
		queue.some(
			(existing) =>
				existing.commandId === record.commandId &&
				existing.status !== "cancelled",
		)
	) {
		return { ok: true, queue, record, duplicate: true };
	}
	if (
		queue.filter((existing) => existing.status === "queued").length >=
		limits.maxPendingCommands
	) {
		return {
			ok: false,
			queue,
			reason: `command queue is full (maxPendingCommands ${limits.maxPendingCommands})`,
		};
	}
	return { ok: true, queue: [...queue, record], record, duplicate: false };
}

/** Cancel queued (undelivered) commands whose work item is already completed (SPEC §13). */
export function cancelQueuedForCompletedItems(
	queue: readonly CommandRecord[],
	projection: TodoProjection,
): { queue: readonly CommandRecord[]; cancelledIds: readonly string[] } {
	const cancelledIds: string[] = [];
	const next: CommandRecord[] = [];
	for (const record of queue) {
		const item = projection.items.get(record.workItemId);
		if (
			record.status === "queued" &&
			item !== undefined &&
			item.status === "completed"
		) {
			cancelledIds.push(record.commandId);
			next.push({ ...record, status: "cancelled" });
			continue;
		}
		next.push(record);
	}
	return { queue: next, cancelledIds };
}

/**
 * Take the head queued command as the single active command (SPEC §11). The record is
 * removed from the pending queue — pending commands and the active command are persisted
 * separately (SPEC §15). Returns undefined when the queue is empty or a command is active.
 */
export function takeNextCommand(
	queue: readonly CommandRecord[],
	activeCommand: CommandRecord | undefined,
): { command: CommandRecord; queue: readonly CommandRecord[] } | undefined {
	if (activeCommand !== undefined) {
		return undefined;
	}
	const index = queue.findIndex((record) => record.status === "queued");
	if (index === -1) {
		return undefined;
	}
	const record = queue[index];
	if (record === undefined) {
		return undefined;
	}
	const command = { ...record, status: "active" as const };
	const next = queue.filter((_, position) => position !== index);
	return { command, queue: next };
}
