/** Automation scan: one automation reads one view and issues one command per outstanding row (SPEC §10). */

import {
	buildCommandRecord,
	cancelQueuedForCompletedItems,
	enqueueCommand,
} from "./command-queue.js";
import { applyEvent, type TodoProjection } from "./projector.js";
import type { EventLoopRuntime } from "./runtime.js";
import { outstandingItems } from "./todo-view.js";
import {
	type CommandRecord,
	deriveCommandId,
	type EventLoopConfig,
	type LoopEventData,
	type PostAppendEffects,
} from "./types.js";

interface ScanOutcome {
	/** New commands to enqueue, in row sequence. */
	readonly records: readonly CommandRecord[];
	/** Outstanding rows skipped because their stable command already exists. */
	readonly duplicates: number;
}

/**
 * Scan all automations in configuration order. Each automation issues its configured
 * command for each outstanding row of its view; there is no domain branching here.
 * Known command IDs (queued, active or already issued this scan) are deduplicated.
 */
export function scanAutomations(
	config: EventLoopConfig,
	profileName: string,
	projection: TodoProjection,
	knownCommandIds: ReadonlySet<string>,
): ScanOutcome {
	const profile = config.profiles[profileName];
	if (profile === undefined) {
		return { records: [], duplicates: 0 };
	}
	const records: CommandRecord[] = [];
	const seen = new Set(knownCommandIds);
	let duplicates = 0;
	for (const automation of profile.automations) {
		for (const item of outstandingItems(projection, automation.view)) {
			const commandId = deriveCommandId(
				profileName,
				automation.id,
				item.workItemId,
			);
			if (seen.has(commandId)) {
				duplicates++;
				continue;
			}
			const record = buildCommandRecord(profileName, profile, automation, item);
			if (record === undefined) {
				continue;
			}
			seen.add(commandId);
			records.push(record);
		}
	}
	return { records, duplicates };
}

/**
 * Post-append pipeline: project → scan views → queue commands (SPEC §7 transaction order).
 * Mutates the runtime projection and queue; returns the effects of this single event.
 */
export function createPostAppendPipeline(
	runtime: EventLoopRuntime,
): (
	event: LoopEventData,
	config: EventLoopConfig,
	profileName: string,
) => PostAppendEffects {
	return (event, config, profileName) => {
		const before = runtime.projection;
		runtime.projection = applyEvent(
			runtime.projection,
			config,
			profileName,
			event,
		);
		// Only items newly opened by this apply count as effects; replaying an event whose
		// item already exists must report nothing (deterministic IDs, SPEC §7).
		const workItemIds = runtime.projection.order.filter(
			(itemId) => !before.items.has(itemId),
		);

		const known = new Set(runtime.queue.map((record) => record.commandId));
		if (runtime.activeCommand !== undefined) {
			known.add(runtime.activeCommand.commandId);
		}
		const scan = scanAutomations(
			config,
			profileName,
			runtime.projection,
			known,
		);

		const commandIds: string[] = [];
		for (const record of scan.records) {
			const outcome = enqueueCommand(runtime.queue, record, config.limits);
			if (!outcome.ok) {
				// Loop protection: pause with an operator-visible reason on queue exhaustion (SPEC §14).
				runtime.paused = true;
				runtime.pauseReason = outcome.reason;
				break;
			}
			runtime.queue = outcome.queue;
			if (!outcome.duplicate) {
				commandIds.push(record.commandId);
			}
		}
		// A closing event may complete items whose commands are still queued (SPEC §13).
		runtime.queue = cancelQueuedForCompletedItems(
			runtime.queue,
			runtime.projection,
		).queue;
		return { workItemIds, commandIds };
	};
}
