/**
 * Matrix extension — entry point.
 *
 * Bridges a private Matrix room to the Chief of Staff agent's inbox.
 * Outbound: matrix_send tool. Inbound: sync loop → bridgeInbound →
 * sendAgentMessage. End-to-end encrypted via matrix-bot-sdk's Rust crypto.
 *
 * Configured via the `matrix` block in ~/.pi/agent/settings.json (or in
 * a project-level settings.json such as ~/git/coas/.pi/settings.json).
 * The bot's access token is read from an environment variable; never
 * stored in any settings file.
 *
 * Tools:    matrix_send, matrix_status
 * Commands: /matrix          (status overlay / inline)
 *
 * The extension is a no-op if no `matrix` block is configured — useful
 * for opting out without removing the extension from settings.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { join } from "node:path";

import { ok, fail, type ToolResult } from "../../lib/tool-result.js";
import { loadMatrixConfig } from "./config.js";
import { MatrixBridgeClient } from "./client.js";
import { mxidLocalpart } from "./bridge.js";
import type { MatrixConfig } from "./types.js";

// ── Extension state (module-level singletons) ───────────────────

let config: MatrixConfig | null = null;
let client: MatrixBridgeClient | null = null;
let ctx: ExtensionContext | null = null;
let lastError: string | null = null;

// ── Status helpers ──────────────────────────────────────────────

function updateStatus(): void {
	if (!ctx) return;
	if (!config) {
		ctx.ui.setStatus("matrix", "📡 matrix: not configured");
		return;
	}
	if (!client) {
		ctx.ui.setStatus("matrix", "📡 matrix: idle");
		return;
	}
	const s = client.getStatus();
	if (lastError) {
		ctx.ui.setStatus("matrix", `📡 matrix: error — ${lastError}`);
		return;
	}
	if (!s.connected) {
		ctx.ui.setStatus("matrix", "📡 matrix: disconnected");
		return;
	}
	const ageSec = s.lastSyncMs ? Math.round((Date.now() - s.lastSyncMs) / 1000) : -1;
	const enc = s.roomEncrypted ? "🔒" : "  ";
	ctx.ui.setStatus("matrix", `📡 ${enc} matrix: connected, last sync ${ageSec}s ago`);
}

// ── Inbound delivery ────────────────────────────────────────────
//
// Inject directly into the current pi session via pi.sendUserMessage.
// This is the same-process fast path — the extension IS inside pi, so
// there's no need to route through panopticon → Maildir → drainInbox.
// The message surfaces immediately in the agent's prompt as a followUp.

let piRef: ExtensionAPI | null = null;

function onInbound(msg: { roomId: string; senderMxid: string; body: string; eventId: string; timestampMs: number }): void {
	if (!piRef) return;
	const from = `matrix:${mxidLocalpart(msg.senderMxid)}`;
	piRef.sendUserMessage(`[from ${from}]: ${msg.body}`, { deliverAs: "followUp" });
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	piRef = pi;

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		lastError = null;

		// Project-level settings.json takes precedence (e.g. ~/git/coas/.pi/settings.json)
		const projectSettingsPath = join(c.cwd, ".pi", "settings.json");
		try {
			config = loadMatrixConfig(projectSettingsPath);
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
		try {
			await client.start(onInbound);
		} catch (err) {
			lastError = (err as Error).message;
			ctx.ui.notify(`matrix: failed to connect — ${lastError}`, "error");
			client = null;
		}
		updateStatus();
	});

	pi.on("session_shutdown", async () => {
		if (client) await client.stop();
		client = null;
		config = null;
		ctx = null;
	});

	// Inject a one-line system-prompt hint for the chief of staff so it
	// knows the matrix channel exists and how to reply over it.
	pi.on("before_agent_start", async (event) => {
		if (!config || !client) return;
		const hint =
			`\n\n<matrix-channel>\n` +
			`You have a Matrix-backed channel to the human at ${config.userId}. ` +
			`Inbound messages arrive in your inbox tagged \`[from matrix:<localpart>]\`. ` +
			`Reply via the matrix_send tool — messages are end-to-end encrypted.\n` +
			`</matrix-channel>`;
		return { systemPrompt: `${event.systemPrompt}${hint}` };
	});

	// ── Tool: matrix_send ──────────────────────────────────────

	pi.registerTool({
		name: "matrix_send",
		label: "Matrix Send",
		description:
			"Send an end-to-end encrypted message to the configured Matrix room. " +
			"The room is bound to a single human (the Chief of Staff's principal user). " +
			"Use this to reply to inbound `[from matrix:...]` messages, deliver status updates, " +
			"or push notifications to the user's phone.",
		promptSnippet: "Send a message to the human via Matrix",
		promptGuidelines: [
			"Only use this when the message is intended for the human, not for peer agents — use agent_send for those.",
			"Messages are end-to-end encrypted; do not include verbatim secrets you have been told to keep private even in encrypted form.",
			"Prefer concise messages — the user is reading on a phone.",
		],
		parameters: Type.Object({
			message: Type.String({ description: "Message body. Plain text. Markdown is rendered by Element X." }),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			if (!client || !config) return fail("Matrix is not configured or not connected");
			try {
				const { eventId } = await client.send(params.message);
				return ok(`Sent to ${config.roomId} (event ${eventId})`, { eventId, roomId: config.roomId });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return fail(`Matrix send failed: ${msg}`, { error: msg });
			}
		},
	});

	// ── Tool: matrix_status ────────────────────────────────────

	pi.registerTool({
		name: "matrix_status",
		label: "Matrix Status",
		description: "Report the Matrix bridge connection state, last-sync age, and the configured room/target agent.",
		promptSnippet: "Check the Matrix bridge connection state",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			if (!config) return ok("Matrix: not configured (no `matrix` block in settings.json).", { configured: false });
			if (!client) return ok(`Matrix: configured but not connected. ${lastError ?? ""}`, { configured: true, connected: false, error: lastError });

			const s = client.getStatus();
			const ageSec = s.lastSyncMs ? Math.round((Date.now() - s.lastSyncMs) / 1000) : -1;
			const lines = [
				`Matrix bridge:`,
				`  Homeserver:    ${config.homeserver}`,
				`  Bot user:      ${config.userId}`,
				`  Room:          ${config.roomId}`,
				`  Target agent:  ${config.targetAgent}`,
				`  Encryption:    ${config.encryption ? "ON (E2EE)" : "OFF"}`,
				`  Connected:     ${s.connected ? "yes" : "no"}`,
				`  Last sync:     ${ageSec >= 0 ? `${ageSec}s ago` : "never"}`,
				`  Device ID:     ${s.deviceId ?? "(not yet assigned)"}`,
			];
			if (lastError) lines.push(`  Last error:    ${lastError}`);
			return ok(lines.join("\n"), { config: { ...config, accessToken: "[redacted]" }, status: s });
		},
	});

	// ── /matrix slash command ──────────────────────────────────

	pi.registerCommand("matrix", {
		description: "Show Matrix bridge status",
		handler: async (_args, c) => {
			if (!config) {
				c.ui.notify("Matrix: not configured", "info");
				return;
			}
			if (!client) {
				c.ui.notify(`Matrix: not connected. ${lastError ?? ""}`, "warning");
				return;
			}
			const s = client.getStatus();
			const ageSec = s.lastSyncMs ? Math.round((Date.now() - s.lastSyncMs) / 1000) : -1;
			c.ui.notify(
				`Matrix: ${s.connected ? "connected" : "disconnected"} as ${config.userId}, ` +
				`last sync ${ageSec}s ago, encryption ${config.encryption ? "ON" : "OFF"}`,
				s.connected ? "info" : "warning",
			);
		},
	});
}
