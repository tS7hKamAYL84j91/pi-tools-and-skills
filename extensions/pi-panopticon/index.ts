/**
 * Pi Agents — Unified Agent Infrastructure
 *
 * Single extension entry point that orchestrates:
 * - Registry: agent registration, heartbeat, dead-agent reaping
 * - Messaging: agent_send, agent_broadcast, /send command
 * - Spawner: spawn_agent, rpc_send, list_spawned, kill_agent
 * - Peek: agent_peek tool
 * - UI: powerline widget, /agents overlay, /alias command
 *
 * Lifecycle ordering:
 *   start:    registry.register → messaging.init → ui.start
 *   shutdown: spawner.shutdownAll → messaging.drainInbox → ui.stop → registry.unregister
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import Registry from "./registry.js";
import defaultMessaging from "./messaging.js";
import { setupSpawner } from "./spawner.js";
import { setupPeek } from "./peek.js";
import { setupHealth } from "./health.js";
import { setupUI } from "./ui.js";
import { OperationalStateStore } from "./state.js";
import { setupReconciler } from "./reconciler.js";

export default function (pi: ExtensionAPI) {
	const selfId = `${process.pid}-${Date.now().toString(36)}`;
	const registry = new Registry(selfId);

	// Set up modules — registers tools/commands, returns module handles
	const messaging = defaultMessaging(pi, registry);
	const spawner = setupSpawner(pi);
	setupPeek(pi, registry);
	setupHealth(pi, registry);
	const operationalState = new OperationalStateStore(pi);
	const reconciler = setupReconciler(pi, registry, selfId, operationalState);
	const ui = setupUI(pi, registry, selfId);

	// ── Lifecycle: start ────────────────────────────────────────

	// Wire missing-DONE safety net: when a spawned agent exits without
	// sending a completion signal, inject a followUp to alert the orchestrator.
	spawner.onMissingDone((agentName, pid, exitCode, durationMs) => {
		const mins = Math.round(durationMs / 60_000);
		pi.sendUserMessage(
			`⚠️ Agent "${agentName}" (pid ${pid}) exited (code ${exitCode ?? "unknown"}) after ${mins}m without sending a completion signal (DONE/BLOCKED/FAILED). ` +
			`Check its output with list_spawned or agent_peek. If it completed work, update kanban manually.`,
			{ deliverAs: "followUp" },
		);
	});

	pi.on("session_start", async (event, ctx) => {
		registry.register(ctx);
		operationalState.restore(ctx, event);
		messaging.init();
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
		messaging.drainInbox();
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
		messaging.drainInbox();
		messaging.dispose();
		ui.stop();
		registry.unregister();
	});
}
