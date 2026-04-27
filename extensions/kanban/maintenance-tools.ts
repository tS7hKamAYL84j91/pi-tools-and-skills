/**
 * Kanban maintenance tool registrations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { runManualCompaction } from "./compaction.js";

export function registerMaintenanceTools(pi: ExtensionAPI): void {
	// ── kanban_compact ──────────────────────────────────────────
	pi.registerTool({
		name: "kanban_compact",
		label: "Kanban Compact",
		description:
			"Compact board.log by rewriting it with minimal events to reconstruct the current state. " +
			"Creates a timestamped backup before rewriting. Preserves all BLOCK/UNBLOCK diagnostic history " +
			"and recent notes. Drops notes for done tasks older than 7 days.",
		promptSnippet: "Compact the kanban board log to reduce event count",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			const { eventsBefore, eventsAfter, backupPath, tasksPreserved } = await runManualCompaction();
			return ok(
				`Compacted board.log: ${eventsBefore} → ${eventsAfter} events (${tasksPreserved} tasks preserved)\nBackup: ${backupPath}`,
				{ eventsBefore, eventsAfter, tasksPreserved, backupPath },
			);
		},
	});
}
