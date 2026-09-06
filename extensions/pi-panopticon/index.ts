/** Panopticon extension entrypoint and explicit host-injection factory. */

import type {
	ExtensionAPI,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { resumeAgentApproval } from "../pi-coas/lib/coas-approval-inbox.js";
import { resolveCoasConfig } from "../../lib/coas-config.js";
import type { CoasConfig } from "../../lib/coas-types.js";
import {
	registerChannel,
	unregisterChannel,
} from "../../lib/message-transport.js";
import { getMaildirTransport } from "../../lib/transports/maildir.js";
import { createMessaging } from "./messaging/messaging.js";
import { setupExternalPeerSource } from "./registry/external-peer-source.js";
import { setupHealth } from "./registry/health.js";
import { setupPeek } from "./registry/peek.js";
import { getSelfName } from "./registry/peers.js";
import { setupReconciler } from "./registry/reconciler.js";
import Registry from "./registry/registry.js";
import { OperationalStateStore } from "./registry/state.js";
import { stopPeerAgent } from "./spawner/agent-stop.js";
import { setupMissingDoneNotice } from "./spawner/missing-done-notice.js";
import { setupSpawner } from "./spawner/spawner.js";
import type {
	AgentMessageSender,
	AgentStopper,
} from "./ui/agent-overlay-types.js";
import { createAgentListModeStore } from "./ui/list-mode.js";
import { setupUI } from "./ui/ui.js";

/** Create the extension with an explicit host capability; normal loading passes none. */
export function createPanopticonExtension(): ExtensionFactory {
	return (pi) => setupPanopticon(pi);
}

const defaultExtension = createPanopticonExtension();
export default defaultExtension;

function setupPanopticon(pi: ExtensionAPI): void {
	const selfId = `${process.pid}-${Date.now().toString(36)}`;
	const registry = new Registry(selfId, () => pi.getSessionName());
	const externalPeers = setupExternalPeerSource(pi, registry);
	const listMode = createAgentListModeStore();

	// Set up modules — registers tools/commands, returns module handles
	const operationalState = new OperationalStateStore(pi);
	const reconciler = setupReconciler(pi, registry, selfId, operationalState);
	const maildir = getMaildirTransport();
	registerChannel("agent", maildir);
	const sendAgentMessage: AgentMessageSender = async (peer, message) => {
		const result = await maildir.send(peer, getSelfName(registry), message, selfId);
		return {
			accepted: result.accepted,
			...(result.error ? { error: result.error } : {}),
			...(result.reference ? { reference: result.reference } : {}),
		};
	};
	const stopAgent: AgentStopper = async (peer, force) =>
		stopPeerAgent(peer, selfId, force ?? false);
	const resumeApprovedRun = async (
		config: CoasConfig,
		requestId: string,
	): Promise<boolean> => resumeAgentApproval(pi, config, requestId);
	const messaging = createMessaging({
		send: maildir,
		broadcast: maildir,
		onMessage: (text) => reconciler.handleInboundMessage(text),
	})(pi, registry);
	const spawner = setupSpawner(pi, registry);
	setupPeek(pi, registry, listMode);
	setupHealth(pi, registry, listMode);
	const ui = setupUI(pi, {
		selfId,
		registry,
		listMode,
		sendAgentMessage,
		stopAgent,
		getCoasConfig: (ctx) => resolveCoasConfig(ctx.cwd),
		resumeApprovedRun,
	});

	// ── Lifecycle: start ────────────────────────────────────────

	setupMissingDoneNotice(pi, spawner);

	pi.on("session_start", async (event, ctx) => {
		await externalPeers.refresh(ctx.cwd);
		registry.register(ctx);
		operationalState.restore(ctx, event);
		messaging.init(ctx);
		reconciler.start(ctx);
		if (ctx.hasUI) {
			ui.start(ctx);
		}
	});

	// ── Lifecycle: agent events ─────────────────────────────────

	pi.on("agent_start", async () => {
		registry.setStatus("running");
	});

	pi.on("agent_end", async () => {
		registry.setStatus("waiting");
		messaging.pokePending();
		reconciler.onAgentEnd();
	});

	pi.on("model_select", async (event) => {
		registry.updateModel(`${event.model.provider}/${event.model.id}`);
	});

	pi.on("input", async (event, ctx) => {
		operationalState.recordInput(ctx, event);
		if (event.text) {
			const firstLine = event.text.split("\n")[0]?.slice(0, 80);
			if (firstLine && !registry.getRecord()?.task) {
				registry.setTask(firstLine);
			}
		}
		return { action: "continue" as const };
	});

	// ── Lifecycle: shutdown ─────────────────────────────────────

	pi.on("session_shutdown", async () => {
		await spawner.shutdownAll();
		reconciler.stop();
		messaging.drainAll();
		messaging.dispose();
		unregisterChannel("agent");
		ui.stop();
		registry.unregister();
	});
}
