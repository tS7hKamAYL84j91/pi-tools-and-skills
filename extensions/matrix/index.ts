/**
 * Matrix extension — entry point.
 *
 * Registers a "matrix" messaging channel via the shared channel registry.
 * The panopticon messaging module handles notification (poke-then-read)
 * and provides the unified message_read / message_send tools.
 *
 * This extension handles:
 * - Matrix client lifecycle (connect, sync, shutdown)
 * - Inbound message buffering (via MatrixTransport)
 * - Status bar widget
 * - System prompt hint about messaging
 * - /matrix status command
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { join } from "node:path";

import { registerChannel, unregisterChannel, notifyChannel } from "../../lib/message-transport.js";
import { loadMatrixConfig } from "./config.js";
import { MatrixBridgeClient } from "./client.js";
import { MatrixTransport } from "./transport.js";
import type { MatrixConfig } from "./types.js";

// ── Extension state ─────────────────────────────────────────────

let config: MatrixConfig | null = null;
let client: MatrixBridgeClient | null = null;
let transport: MatrixTransport | null = null;
let ctx: ExtensionContext | null = null;
let lastError: string | null = null;
let channelLabel = "matrix";

// ── Status helpers ──────────────────────────────────────────────

function updateStatus(): void {
	if (!ctx) return;
	if (!config) { ctx.ui.setStatus("matrix", "📡 ✗"); return; }
	if (!client) { ctx.ui.setStatus("matrix", "📡 …"); return; }
	if (lastError) { ctx.ui.setStatus("matrix", "📡 !"); return; }
	if (!client.isConnected()) { ctx.ui.setStatus("matrix", "📡 ✗"); return; }
	const pending = transport?.pendingCount("") ?? 0;
	const unreadTag = pending > 0 ? ` ${pending}✉` : "";
	ctx.ui.setStatus("matrix", `📡${unreadTag}`);
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		lastError = null;

		const projectSettingsPath = join(c.cwd, ".pi", "settings.json");
		try {
			config = loadMatrixConfig(projectSettingsPath);
			channelLabel = config?.channelLabel ?? "matrix";
		} catch (err) {
			lastError = (err as Error).message;
			ctx.ui.notify(`matrix: ${lastError}`, "warning");
			updateStatus();
			return;
		}

		if (!config) {
			updateStatus();
			return;
		}

		client = new MatrixBridgeClient(config);
		transport = new MatrixTransport(client, channelLabel);

		// Register as a messaging channel — panopticon handles notification
		registerChannel(channelLabel, transport);

		try {
			await client.start(
				(msg) => {
					transport?.pushInbound(msg);
					notifyChannel();
					updateStatus();
				},
				(msg, level) => c.ui.notify(`matrix: ${msg}`, level),
			);
		} catch (err) {
			lastError = (err as Error).message;
			ctx.ui.notify(`matrix: failed to connect — ${lastError}`, "error");
			client = null;
		}
		updateStatus();
	});

	pi.on("session_shutdown", async () => {
		unregisterChannel(channelLabel);
		if (client) await client.stop();
		client = null;
		transport = null;
		config = null;
		ctx = null;
	});

	pi.on("before_agent_start", async (event) => {
		if (!config || !client) return;
		const hint =
			`\n\n<message-channel>\n` +
			`You have a messaging channel to the human via "${channelLabel}". When new messages arrive, ` +
			`you'll be notified with a count. Call message_read to fetch them, ` +
			`then reply via message_send. Keep replies concise — the human reads on a phone.\n` +
			`</message-channel>`;
		return { systemPrompt: `${event.systemPrompt}${hint}` };
	});

	// ── /matrix command ───────────────────────────────────────

	pi.registerCommand("matrix", {
		description: "Show Matrix status",
		handler: async (_args, c) => {
			if (!config) { c.ui.notify("Matrix: not configured", "info"); return; }
			if (!client) { c.ui.notify(`Matrix: not connected. ${lastError ?? ""}`, "warning"); return; }
			const pending = transport?.pendingCount("") ?? 0;
			c.ui.notify(
				`Matrix: ${client.isConnected() ? "connected" : "disconnected"}, ${pending} unread`,
				client.isConnected() ? "info" : "warning",
			);
		},
	});
}
