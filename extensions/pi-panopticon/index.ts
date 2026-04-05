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

export default function (pi: ExtensionAPI) {
	const selfId = `${process.pid}-${Date.now().toString(36)}`;
	const registry = new Registry(selfId);

	// Set up modules — registers tools/commands, returns module handles
	const messaging = defaultMessaging(pi, registry);
	const spawner = setupSpawner(pi);
	setupPeek(pi, registry);
	setupHealth(pi, registry);
	const ui = setupUI(pi, registry, selfId);

	// ── Lifecycle: start ────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		registry.register(ctx);
		messaging.init();
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
	});

	pi.on("model_select", async (event) => {
		registry.updateModel(`${event.model.provider}/${event.model.id}`);
	});

	pi.on("input", async (event) => {
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
		messaging.drainInbox();
		messaging.dispose();
		ui.stop();
		registry.unregister();
	});
}
