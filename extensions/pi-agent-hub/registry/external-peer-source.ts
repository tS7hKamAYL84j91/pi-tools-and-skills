/** Refresh the validated external manifest before native peer tools resolve targets. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Registry } from "../types.js";
import { loadExternalAgents } from "./external-registrar.js";

const PEER_TOOLS = new Set(["agent_peek", "agent_status", "agent_send", "agent_broadcast"]);

export function externalPeerConfig(cwd: string) {
	const mailboxRoot = process.env.PI_PANOPTICON_EXTERNAL_MAILBOX_ROOT;
	return {
		workspaceRoot: process.env.PI_PANOPTICON_EXTERNAL_WORKSPACE_ROOT ?? cwd,
		...(mailboxRoot !== undefined ? { mailboxRoot } : {}),
	};
}

export function setupExternalPeerSource(pi: ExtensionAPI, registry: Registry) {
	async function refresh(cwd: string): Promise<void> {
		// Only operator environment configuration can select a shared authority.
		// Clear stale registrations before validation; corrupt sources fail closed.
		registry.setExternalPeers([]);
		const records = await loadExternalAgents(externalPeerConfig(cwd));
		registry.setExternalPeers(records);
	}
	pi.on("tool_call", async (event, ctx) => {
		if (PEER_TOOLS.has(event.toolName)) await refresh(ctx.cwd);
	});
	return { refresh };
}
