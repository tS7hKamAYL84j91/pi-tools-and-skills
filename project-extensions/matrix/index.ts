/**
 * Matrix extension — entry point.
 *
 * Notification + inbox pattern for Matrix messages:
 *
 *   1. Sync loop receives a message from the room
 *   2. Extension buffers it and POKES pi: "you have N new Matrix messages"
 *   3. Pi decides when to read → calls matrix_read tool
 *   4. Tool returns unread messages, clears the buffer
 *   5. Pi responds via matrix_send
 *
 * The agent controls its own attention. Multiple rapid messages batch
 * naturally into one read. Historical messages are readable via
 * matrix_read even if the poke was missed.
 *
 * Tools:    matrix_send, matrix_read, matrix_status
 * Commands: /matrix
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { join } from "node:path";

import { ok, fail, type ToolResult } from "../../lib/tool-result.js";
import { loadMatrixConfig } from "./config.js";
import { MatrixBridgeClient, type InboundMessage } from "./client.js";
import { mxidLocalpart } from "./bridge.js";
import type { MatrixConfig } from "./types.js";

// ── Extension state ─────────────────────────────────────────────

let config: MatrixConfig | null = null;
let client: MatrixBridgeClient | null = null;
let ctx: ExtensionContext | null = null;
let piRef: ExtensionAPI | null = null;
let lastError: string | null = null;

// ── Unread message buffer ───────────────────────────────────────

interface BufferedMessage {
	from: string;
	body: string;
	eventId: string;
	timestampMs: number;
}

const unread: BufferedMessage[] = [];
let pokeTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced poke — waits 2s for more messages before alerting pi.
 * Only pokes when pi is idle (ctx.isIdle()) to avoid racing with an
 * active agent turn. If pi is busy, the poke is rescheduled. The
 * agent will see the unread count in the status bar and can call
 * matrix_read at the end of its current turn.
 */
function schedulePoke(): void {
	if (pokeTimeout) return; // already scheduled
	pokeTimeout = setTimeout(() => {
		pokeTimeout = null;
		if (!piRef || !ctx || unread.length === 0) return;

		// Don't inject during an active turn — reschedule
		if (!ctx.isIdle()) {
			schedulePoke();
			return;
		}

		const count = unread.length;
		const latest = unread[unread.length - 1];
		const preview = latest
			? `Latest from ${latest.from}: "${latest.body.length > 60 ? `${latest.body.slice(0, 60)}…` : latest.body}"`
			: "";
		piRef.sendUserMessage(
			`📱 ${count} new Matrix message${count > 1 ? "s" : ""}. ${preview}\nUse matrix_read to see ${count > 1 ? "them" : "it"}.`,
			{ deliverAs: "followUp" },
		);
	}, 2000);
}

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
	const unreadTag = unread.length > 0 ? ` 📱 ${unread.length} unread` : "";
	ctx.ui.setStatus("matrix", `📡 matrix: connected${unreadTag}`);
}

// ── Inbound handler ─────────────────────────────────────────────

function onInbound(msg: InboundMessage): void {
	const from = `matrix:${mxidLocalpart(msg.senderMxid)}`;
	unread.push({
		from,
		body: msg.body,
		eventId: msg.eventId,
		timestampMs: msg.timestampMs,
	});
	updateStatus();
	schedulePoke();
}

// ── Extension ───────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	piRef = pi;

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, c) => {
		ctx = c;
		lastError = null;
		unread.length = 0;

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
		if (pokeTimeout) clearTimeout(pokeTimeout);
		pokeTimeout = null;
		if (client) await client.stop();
		client = null;
		config = null;
		ctx = null;
		unread.length = 0;
	});

	pi.on("before_agent_start", async (event) => {
		if (!config || !client) return;
		const hint =
			`\n\n<matrix-channel>\n` +
			`You have a Matrix channel to the human. When new messages arrive, ` +
			`you'll be notified with a count. Call matrix_read to fetch them, ` +
			`then reply via matrix_send. Keep replies concise — the human reads on a phone.\n` +
			`</matrix-channel>`;
		return { systemPrompt: `${event.systemPrompt}${hint}` };
	});

	// ── Tool: matrix_read ─────────────────────────────────────

	pi.registerTool({
		name: "matrix_read",
		label: "Matrix Read",
		description:
			"Read unread Matrix messages from the human. Returns all messages " +
			"received since the last read, then clears the unread buffer. " +
			"Call this when you receive a '📱 New Matrix message' notification.",
		promptSnippet: "Read unread Matrix messages from the human",
		promptGuidelines: [
			"Call matrix_read when notified of new messages — don't ignore the notification.",
			"After reading, reply via matrix_send if the human asked a question or needs a response.",
		],
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			if (!client || !config) return fail("Matrix is not configured or not connected");

			if (unread.length === 0) {
				return ok("No unread Matrix messages.", { count: 0, messages: [] });
			}

			const messages = [...unread];
			unread.length = 0;
			updateStatus();

			const lines = messages.map((m) =>
				`[${new Date(m.timestampMs).toLocaleTimeString()}] ${m.from}: ${m.body}`,
			);
			return ok(
				`${messages.length} message${messages.length > 1 ? "s" : ""}:\n${lines.join("\n")}`,
				{ count: messages.length, messages },
			);
		},
	});

	// ── Tool: matrix_send ─────────────────────────────────────

	pi.registerTool({
		name: "matrix_send",
		label: "Matrix Send",
		description:
			"Send a message to the human via the Matrix room. " +
			"Use after reading messages with matrix_read to reply.",
		promptSnippet: "Send a message to the human via Matrix",
		promptGuidelines: [
			"Only use this for the human, not peer agents — use agent_send for those.",
			"Prefer concise messages — the human reads on a phone.",
		],
		parameters: Type.Object({
			message: Type.String({ description: "Message body. Plain text. Markdown rendered by Element X." }),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			if (!client || !config) return fail("Matrix is not configured or not connected");
			try {
				const { eventId } = await client.send(params.message);
				return ok(`Sent (event ${eventId})`, { eventId });
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return fail(`Matrix send failed: ${msg}`, { error: msg });
			}
		},
	});

	// ── Tool: matrix_status ───────────────────────────────────

	pi.registerTool({
		name: "matrix_status",
		label: "Matrix Status",
		description: "Report the Matrix connection state, unread count, and configuration.",
		promptSnippet: "Check Matrix connection state",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal): Promise<ToolResult> {
			if (!config) return ok("Matrix: not configured.", { configured: false });
			if (!client) return ok(`Matrix: not connected. ${lastError ?? ""}`, { configured: true, connected: false });

			const s = client.getStatus();
			const lines = [
				`Matrix: ${s.connected ? "connected" : "disconnected"}`,
				`  Unread:  ${unread.length}`,
				`  Room:    ${config.roomId}`,
				`  Bot:     ${config.userId}`,
			];
			if (lastError) lines.push(`  Error:   ${lastError}`);
			return ok(lines.join("\n"), { connected: s.connected, unread: unread.length });
		},
	});

	// ── /matrix command ───────────────────────────────────────

	pi.registerCommand("matrix", {
		description: "Show Matrix status",
		handler: async (_args, c) => {
			if (!config) { c.ui.notify("Matrix: not configured", "info"); return; }
			if (!client) { c.ui.notify(`Matrix: not connected. ${lastError ?? ""}`, "warning"); return; }
			const s = client.getStatus();
			c.ui.notify(
				`Matrix: ${s.connected ? "connected" : "disconnected"}, ${unread.length} unread`,
				s.connected ? "info" : "warning",
			);
		},
	});
}
