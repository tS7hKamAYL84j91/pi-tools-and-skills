/**
 * Delivery guard for scheduled prompts: workspace, scope, and target-agent checks.
 */
import { PANOPTICON_SPAWN_NAME_ENV } from "../../lib/agent-registry.js";
import { currentWorkspaceLabel } from "./workspace-paths.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CoasConfig, ScheduleEntry } from "./types.js";

const PANOPTICON_SCOPE_ENV = "PI_PANOPTICON_SCOPE";

interface DeliveryIdentity {
	readonly workspaceId: string;
	readonly agentName: string;
	readonly scope: "workspace" | "task" | "unknown";
}

export async function activeIdentity(pi: ExtensionAPI, config: CoasConfig): Promise<DeliveryIdentity> {
	const scopeRaw = process.env[PANOPTICON_SCOPE_ENV];
	const scope: "workspace" | "task" | "unknown" =
		scopeRaw === "task" ? "task" : scopeRaw === "workspace" ? "workspace" : "unknown";
	return {
		workspaceId: process.env.COAS_WORKSPACE_ID ?? await currentWorkspaceLabel(config, process.cwd()) ?? "",
		agentName: process.env[PANOPTICON_SPAWN_NAME_ENV] ?? pi.getSessionName() ?? "",
		scope,
	};
}

export function shouldDeliver(schedule: ScheduleEntry, identity: DeliveryIdentity): { deliver: boolean; reason: string } {
	if (schedule.targetAgent) {
		if (identity.agentName && identity.agentName === schedule.targetAgent) {
			return { deliver: true, reason: `targetAgent match: ${schedule.targetAgent}` };
		}
		return { deliver: false, reason: `targetAgent ${schedule.targetAgent} does not match active agent ${identity.agentName || "(unknown)"}` };
	}

	if (identity.scope === "task") {
		return { deliver: false, reason: "active session is task-scoped" };
	}

	if (identity.workspaceId && identity.workspaceId !== schedule.workspaceId) {
		return { deliver: false, reason: `workspace mismatch: active ${identity.workspaceId} != schedule ${schedule.workspaceId}` };
	}

	return { deliver: true, reason: "workspace/root identity matches" };
}
