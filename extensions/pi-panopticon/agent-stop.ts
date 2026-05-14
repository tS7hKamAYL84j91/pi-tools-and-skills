/** Utilities for stopping peer agent processes from the Panopticon UI. */

import type { AgentRecord } from "./types.js";

interface AgentStopResult {
	accepted: boolean;
	error?: string;
	method?: "SIGTERM" | "SIGKILL";
	pid?: number;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Stop a visible peer agent process. Never stops the current agent. */
export function stopPeerAgent(
	record: AgentRecord,
	selfId: string,
	force = false,
): AgentStopResult {
	if (record.id === selfId) {
		return { accepted: false, error: "Refusing to stop the current agent." };
	}
	if (!Number.isInteger(record.pid) || record.pid <= 0) {
		return { accepted: false, error: `Agent ${record.name} has no valid PID.` };
	}

	try {
		process.kill(record.pid, 0);
	} catch (error) {
		return {
			accepted: false,
			error: `Agent ${record.name} process ${record.pid} is not running: ${errorMessage(error)}`,
			pid: record.pid,
		};
	}

	const method = force ? "SIGKILL" : "SIGTERM";
	try {
		process.kill(record.pid, method);
		return { accepted: true, method, pid: record.pid };
	} catch (error) {
		return {
			accepted: false,
			error: `Failed to stop agent ${record.name} process ${record.pid}: ${errorMessage(error)}`,
			pid: record.pid,
		};
	}
}
