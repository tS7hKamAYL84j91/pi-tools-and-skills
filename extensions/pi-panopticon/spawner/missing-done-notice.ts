/** Emits a bounded recovery notice for spawned agents that exit without a terminal signal. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { setupSpawner } from "./spawner.js";

/** Registers the missing-DONE safety net with the extension lifecycle. */
export function setupMissingDoneNotice(
	pi: ExtensionAPI,
	spawner: ReturnType<typeof setupSpawner>,
): void {
	spawner.onMissingDone((agentName, pid, exitCode, durationMs) => {
		const minutes = Math.round(durationMs / 60_000);
		pi.sendUserMessage(
			`⚠️ Agent "${agentName}" (pid ${pid}) exited (code ${exitCode ?? "unknown"}) after ${minutes}m without sending a completion signal (DONE/BLOCKED/FAILED). ` +
				"Check its output with list_spawned or agent_peek. If it completed work, reconcile its results manually.",
			{ deliverAs: "followUp" },
		);
	});
}
