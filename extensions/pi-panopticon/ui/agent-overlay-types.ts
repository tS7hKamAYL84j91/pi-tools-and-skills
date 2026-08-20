/**
 * Shared dependency types for panopticon agent overlays.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CoasConfig } from "../../../lib/coas-types.js";
import type { AgentListModeStore } from "./list-mode.js";
import type { AgentRecord, Registry } from "../types.js";

export interface AgentMessageDelivery {
	accepted: boolean;
	error?: string;
	reference?: string;
}

export type AgentMessageSender = (
	record: AgentRecord,
	message: string,
) => Promise<AgentMessageDelivery>;

export interface AgentStopDelivery {
	accepted: boolean;
	error?: string;
	method?: "SIGTERM" | "SIGKILL";
	pid?: number;
}

export type AgentStopper = (
	record: AgentRecord,
	force?: boolean,
) => Promise<AgentStopDelivery>;

export interface AgentOverlayDeps {
	selfId: string;
	registry: Registry;
	listMode: AgentListModeStore;
	sendAgentMessage: AgentMessageSender;
	stopAgent: AgentStopper;
	/** Resolve CoAS configuration for the current extension context. */
	getCoasConfig?: (ctx: ExtensionContext) => CoasConfig | undefined;
	/** Resume an approved scheduled run; used by the approval-inbox surface. */
	resumeApprovedRun?: (config: CoasConfig, requestId: string) => Promise<boolean>;
}
