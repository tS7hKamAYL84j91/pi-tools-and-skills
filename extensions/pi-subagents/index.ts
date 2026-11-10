/** Persistent local RPC workers, independent of peer messaging. */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { findCurrentAgentIdentity } from "../../lib/agent-identity.js";
import { BEFORE_AGENT_CHANNEL_SHUTDOWN, type AgentChannelShutdown } from "../../lib/agent-shutdown.js";
import { normalizeNamespace, PANOPTICON_NAMESPACE_ENV } from "../../lib/agent-registry.js";
import { setupMissingDoneNotice } from "./spawner/missing-done-notice.js";
import { setupSpawner } from "./spawner/spawner.js";

export default function subagents(pi: ExtensionAPI): void {
	const selfId = `${process.pid}-${randomUUID()}`;
	let sessionFile: string | undefined;
	const spawner = setupSpawner(pi, () => findCurrentAgentIdentity(sessionFile) ?? {
		id: selfId,
		name: "",
		namespace: normalizeNamespace(process.env[PANOPTICON_NAMESPACE_ENV]),
	});
	setupMissingDoneNotice(pi, spawner);
	let shutdown: Promise<void> | undefined;
	const shutdownAll = () => (shutdown ??= spawner.shutdownAll());
	const unsubscribe = pi.events.on(BEFORE_AGENT_CHANNEL_SHUTDOWN, (data) => {
		(data as AgentChannelShutdown).waitUntil(shutdownAll());
	});

	pi.on("session_start", (_event, ctx) => {
		sessionFile = ctx.sessionManager.getSessionFile();
	});

	pi.on("session_shutdown", async () => {
		try {
			await shutdownAll();
		} finally {
			unsubscribe();
		}
	});
}
