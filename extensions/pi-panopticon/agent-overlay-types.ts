/**
 * Shared dependency types for panopticon agent overlays.
 */

import type { AgentListModeStore } from "./list-mode.js";
import type { AgentRecord, Registry } from "./types.js";

export interface AgentMessageDelivery {
	accepted: boolean;
	error?: string;
	reference?: string;
}

export type AgentMessageSender = (
	record: AgentRecord,
	message: string,
) => Promise<AgentMessageDelivery>;

export interface AgentOverlayDeps {
	selfId: string;
	registry: Registry;
	listMode: AgentListModeStore;
	sendAgentMessage: AgentMessageSender;
}
