/**
 * Shared types for the pi-panopticon extension.
 *
 * Leaf-level module — no imports from sibling modules.
 */

export { type AgentRecord, type AgentStatus, REGISTRY_DIR, STALE_MS } from "../../lib/agent-registry.js";
export type { MessageTransport } from "../../lib/message-transport.js";
export { ok, fail, type ToolResult } from "../../lib/tool-result.js";

import type { AgentRecord, AgentStatus } from "../../lib/agent-registry.js";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

// ── Registry interface ──────────────────────────────────────────

/** Single owner of the agent's AgentRecord. All mutations go through here. */
export interface Registry {
	/** The current agent's id. */
	readonly selfId: string;
	/** Get a snapshot of the current record (undefined before register). */
	getRecord(): AgentRecord | undefined;
	/** Register this agent. Creates the record and starts heartbeat. */
	register(ctx: ExtensionContext): void;
	/** Unregister. Stops heartbeat and removes the record file. */
	unregister(): void;
	/** Update status and flush. */
	setStatus(status: AgentStatus): void;
	/** Update model string and flush. */
	updateModel(model: string): void;
	/** Update task string and flush. */
	setTask(task: string): void;
	/** Update pending message count and flush. */
	updatePendingMessages(count: number): void;
	/** Update the socket path and flush. */
	setSocket(path: string | undefined): void;
	/** Read all live agent records (reaps dead ones). */
	readAllPeers(): AgentRecord[];
	/** Flush the in-memory record to disk. */
	flush(): void;
}
