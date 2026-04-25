/**
 * Session-local agent list mode store.
 *
 * List mode is a query/display preference for passive panopticon surfaces
 * (/agents, agent_peek, agent_status, widget), separate from registry
 * visibility/access semantics.
 */

import type { AgentRecord } from "../../lib/agent-registry.js";
import { defaultAgentListMode, type AgentListMode } from "./visibility.js";

/** Session-local preference for passive agent lists/widgets. */
export interface AgentListModeStore {
	get(self?: AgentRecord): AgentListMode;
	set(mode: AgentListMode): void;
}

export function createAgentListModeStore(): AgentListModeStore {
	let mode: AgentListMode | undefined;
	return {
		get(self?: AgentRecord): AgentListMode {
			return mode ?? defaultAgentListMode(self);
		},
		set(next: AgentListMode): void {
			mode = next;
		},
	};
}
