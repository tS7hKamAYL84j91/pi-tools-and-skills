/** Read-only operator status renderers for pi-event-loop (SPEC §16). */
import type { SessionEntryLike } from "./event-log.js";
import { readEventLog } from "./event-log.js";
import type { EventLoopRuntime } from "./runtime.js";
import type { EventLoopConfig, ProfileConfig, TodoItem } from "./types.js";

export interface EventLoopStatus {
	readonly profileName: string;
	readonly paused: boolean;
	readonly pauseReason?: string;
	readonly busy: boolean;
	readonly consecutiveAutomatedTurns: number;
	readonly activeCommand?: {
		readonly commandId: string;
		readonly type: string;
		readonly workItemId: string;
		readonly expectedEvents: readonly string[];
	};
	readonly activeWorkItem?: TodoItem;
	readonly pendingCommandCount: number;
	readonly viewRows: Readonly<Record<string, readonly TodoItem[]>>;
	readonly eventCount: number;
}

/** Build a read-only status snapshot from live runtime state and session entries. */
export function buildStatus(
	runtime: EventLoopRuntime,
	config: EventLoopConfig,
	entries: readonly SessionEntryLike[],
): EventLoopStatus {
	const profile = config.profiles[config.activeProfile];
	const viewRows: Record<string, readonly TodoItem[]> = {};
	if (profile !== undefined) {
		for (const viewId of Object.keys(profile.views)) {
			viewRows[viewId] = [...runtime.projection.order]
				.map((itemId) => runtime.projection.items.get(itemId))
				.filter(
					(item): item is TodoItem =>
						item !== undefined && item.viewId === viewId,
				);
		}
	}
	const activeCommand = runtime.activeCommand;
	return {
		profileName: config.activeProfile,
		paused: runtime.paused,
		pauseReason: runtime.pauseReason,
		busy: runtime.busy,
		consecutiveAutomatedTurns: runtime.consecutiveAutomatedTurns,
		activeCommand: activeCommand
			? {
					commandId: activeCommand.commandId,
					type: activeCommand.type,
					workItemId: activeCommand.workItemId,
					expectedEvents: activeCommand.expectedEvents,
				}
			: undefined,
		activeWorkItem: runtime.activeWorkItem,
		pendingCommandCount: runtime.queue.filter(
			(command) => command.status === "queued",
		).length,
		viewRows,
		eventCount: readEventLog(entries).length,
	};
}

/** Render a compact status panel suitable for `/event-loop status`. */
export function formatStatus(status: EventLoopStatus): string {
	const lines = [
		`profile: ${status.profileName}`,
		`state: ${status.paused ? `paused (${status.pauseReason ?? "no reason"})` : "running"}`,
		`busy: ${status.busy ? "yes" : "no"}`,
		`consecutive automated turns: ${status.consecutiveAutomatedTurns}`,
		`pending commands: ${status.pendingCommandCount}`,
		`events: ${status.eventCount}`,
	];
	if (status.activeCommand !== undefined) {
		lines.push(
			`active command: ${status.activeCommand.type} (${status.activeCommand.commandId})`,
		);
		lines.push(`active work item: ${status.activeCommand.workItemId}`);
	}
	return lines.join("\n");
}

/** Render view rows in deterministic projection order. */
export function formatViews(status: EventLoopStatus, viewId?: string): string {
	const ids = viewId === undefined ? Object.keys(status.viewRows) : [viewId];
	const sections: string[] = [];
	for (const id of ids) {
		const rows = status.viewRows[id];
		if (rows === undefined) {
			sections.push(`${id}: unknown view`);
			continue;
		}
		sections.push(`${id}:`);
		for (const row of rows) {
			sections.push(`- ${row.workItemId} [${row.status}] key=${row.key}`);
		}
		if (rows.length === 0) sections.push("- (empty)");
	}
	return sections.join("\n");
}

/** Render bounded session history; payloads are intentionally summarized as data. */
export function formatHistory(
	entries: readonly SessionEntryLike[],
	count = 20,
): string {
	const events = readEventLog(entries).slice(-Math.max(0, count));
	if (events.length === 0) return "(no events)";
	return events
		.map(
			(event) =>
				`${event.occurredAt} ${event.source} ${event.type} [${event.eventId}] payload=${JSON.stringify(event.payload)}`,
		)
		.join("\n");
}

/** Active profile lookup kept as a small read-only helper for context/command surfaces. */
export function activeProfile(
	config: EventLoopConfig,
): ProfileConfig | undefined {
	return config.profiles[config.activeProfile];
}
