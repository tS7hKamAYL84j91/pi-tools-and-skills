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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

import { registerChannel, unregisterChannel, notifyChannel } from "../../lib/message-transport.js";
import { loadMatrixConfig } from "./config.js";
import { FileSyncStateStore } from "./sync-state.js";
import { MatrixJsSdkAdapter } from "./js-sdk-adapter.js";
import { MatrixBridgeClient } from "./client.js";
import {
	classifyMatrixConfigError,
	matrixDiagnosticSummary,
	matrixStatusText,
	sanitizeMatrixError,
	type MatrixConnectionState,
} from "./status.js";
import { MatrixTransport } from "./transport.js";
import type { MatrixConfig } from "./types.js";

// ── Extension state ─────────────────────────────────────────────

let config: MatrixConfig | null = null;
let client: MatrixBridgeClient | null = null;
let transport: MatrixTransport | null = null;
let ctx: ExtensionContext | null = null;
let lastError: string | null = null;
let connectionState: MatrixConnectionState = "not_configured";
let channelLabel = "matrix";

// ── Status helpers ──────────────────────────────────────────────

function currentDiagnosticInput() {
	return {
		config,
		state: connectionState,
		unreadCount: transport?.pendingCount("") ?? 0,
		lastError,
	};
}

function updateStatus(): void {
	if (!ctx) return;
	ctx.ui.setStatus("pi-matrix", matrixStatusText(currentDiagnosticInput()));
}

function emitMatrixMessage(context: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
	if (context.hasUI) {
		context.ui.notify(message, level);
		return;
	}
	console.log(message);
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		config = null;
		lastError = null;
		connectionState = "not_configured";

		const projectSettingsPath = join(c.cwd, ".pi", "settings.json");
		try {
			config = loadMatrixConfig(projectSettingsPath);
			channelLabel = config?.channelLabel ?? "matrix";
		} catch (err) {
			lastError = sanitizeMatrixError(err instanceof Error ? err.message : String(err));
			connectionState = classifyMatrixConfigError(lastError ?? "");
			emitMatrixMessage(c, `matrix: ${lastError}`, "warning");
			updateStatus();
			return;
		}

		if (!config) {
			updateStatus();
			return;
		}

		if (config.allowAnySender) {
			emitMatrixMessage(c, "matrix: allowAnySender is enabled; accepting messages from any Matrix sender (dev/test override)", "warning");
		}

		connectionState = "connecting";
		updateStatus();
		client = new MatrixBridgeClient(config, new MatrixJsSdkAdapter(new FileSyncStateStore({ storagePath: config.storagePath })));
		transport = new MatrixTransport(client, channelLabel, config.ingress, (msg) =>
			emitMatrixMessage(c, msg, "warning"),
		);

		// Register as a messaging channel — panopticon handles notification.
		registerChannel(channelLabel, transport);

		try {
			await client.start(
				(msg) => {
					transport?.pushInbound(msg);
					notifyChannel();
					updateStatus();
				},
				(msg, level) => emitMatrixMessage(c, `matrix: ${sanitizeMatrixError(msg) ?? msg}`, level),
			);
			connectionState = client.isConnected() ? "connected" : "disconnected";
		} catch (err) {
			lastError = sanitizeMatrixError(err instanceof Error ? err.message : String(err));
			connectionState = "error";
			emitMatrixMessage(c, `matrix: failed to connect — ${lastError}`, "error");
			unregisterChannel(channelLabel);
			try {
				await client.stop();
			} catch {
				// Preserve the startup failure; the client is discarded below.
			}
			client = null;
			transport = null;
		}
		updateStatus();
	});

	pi.on("session_shutdown", async () => {
		unregisterChannel(channelLabel);
		if (client) await client.stop();
		client = null;
		transport = null;
		config = null;
		connectionState = "not_configured";
		ctx = null;
	});

	pi.on("before_agent_start", async (event) => {
		if (!config || !client) return;
		const hint =
			`\n\n<message-channel>\n` +
			`You have a messaging channel to the human via "${channelLabel}". When new messages arrive, ` +
			`you'll be notified with a count. Call message_read to fetch them. Matrix attachments may include ` +
			`local file paths; use read on image/PDF/file paths when needed, never execute attachments. ` +
			`Reply via message_send. Keep replies concise — the human reads on a phone.\n` +
			`</message-channel>`;
		return { systemPrompt: `${event.systemPrompt}${hint}` };
	});

	// ── /matrix command ───────────────────────────────────────

	pi.registerCommand("matrix", {
		description: "Show Matrix diagnostic summary and recovery action",
		handler: async (_args, c) => {
			const state = client && connectionState !== "error"
				? client.isConnected() ? "connected" : "disconnected"
				: connectionState;
			const summary = matrixDiagnosticSummary({
				config,
				state,
				unreadCount: transport?.pendingCount("") ?? 0,
				lastError,
			});
			emitMatrixMessage(c, summary, state === "connected" ? "info" : "warning");
		},
	});
}
