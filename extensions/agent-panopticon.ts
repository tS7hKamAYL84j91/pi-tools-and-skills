/**
 * Agent Panopticon — Central Observation & Registry
 *
 * A central point from which to observe all running agents.
 * Every pi instance registers itself on startup and heartbeats its status.
 * Provides tools to discover agents, observe their state, and send messages.
 *
 * Features:
 * - Agent discovery by name
 * - Status/task/model tracking via heartbeat
 * - Widget showing all agents and their state in the pi UI
 * - Tools to peek at agent panes and send messages
 *
 * Registry: ~/.pi/agents/{id}.json
 * - Written by each agent on session_start
 * - Heartbeat every 5s with updated status
 * - Removed on session_shutdown
 * - Stale entries (>30s no heartbeat) cleaned by readers
 *
 * Transport (layered, with fallback):
 * 1. Unix socket    — primary IPC (direct message delivery via pi.sendUserMessage)
 * 2. Maildir        — passive progress observation for agent_peek
 * 3. tmux send-keys — legacy fallback for agents with tmux panes
 *
 * Maildir: ~/.pi/agents/{id}/
 * - Each lifecycle event written as an individual JSON file
 * - Filename: {timestamp}-{seq}-{event}.json (atomic, sortable)
 * - Pruned to last MAX_MAILDIR_ENTRIES on each write
 * - agent_peek reads the latest N files
 *
 * Socket: ~/.pi/agents/{id}.sock
 * - Unix domain socket opened by each agent on session_start
 * - Protocol: client sends one JSON line, server responds with one JSON line
 * - Commands: {"type":"message","from":"...","text":"..."} → pi.sendUserMessage()
 *             {"type":"peek","lines":N} → returns latest Maildir entries
 * - agent_send connects and sends message command
 *
 * Commands:
 * - /alias <name>     — set your agent name (must be unique)
 * - /agents           — list all registered agents
 * - /send <name> msg  — send a message to a peer
 * - agent_peek        — observe agent registry and activity
 * - agent_send        — send messages to peers
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import * as net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ── Types ───────────────────────────────────────────────────────

type AgentStatus = "running" | "waiting" | "stalled" | "terminated" | "unknown";

interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
	tmux?: string;
	socket?: string;
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	task?: string;
}

interface MaildirEntry {
	ts: number;
	event: string;
	[key: string]: unknown;
}

interface SocketCommand {
	type: "message" | "peek";
	from?: string;
	text?: string;
	lines?: number;
}

interface SocketResponse {
	ok: boolean;
	error?: string;
	entries?: MaildirEntry[];
}

// ── Constants ───────────────────────────────────────────────────

const REGISTRY_DIR = join(homedir(), ".pi", "agents");
const HEARTBEAT_MS = 5_000;
const STALE_MS = 30_000;
const MAX_MAILDIR_ENTRIES = 200;
const SOCKET_TIMEOUT_MS = 3_000;

const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "🟢",
	waiting: "🔴",
	stalled: "🟡",
	terminated: "⚫",
	unknown: "⚪",
};

// ── Pure functions ──────────────────────────────────────────────

/** Classify a record as live, stalled, or dead based on heartbeat age. */
function classifyRecord(
	record: AgentRecord,
	now: number,
	pidAlive: boolean,
): "live" | "stalled" | "dead" {
	if (now - record.heartbeat <= STALE_MS) return "live";
	return pidAlive ? "stalled" : "dead";
}

/** Build a fresh record snapshot (pure — no IO). */
function buildRecord(
	base: AgentRecord,
	status: AgentStatus,
	task: string | undefined,
): AgentRecord {
	return { ...base, heartbeat: Date.now(), status, task };
}

/** Format age as human-readable string. */
function formatAge(startedAt: number): string {
	const secs = Math.round((Date.now() - startedAt) / 1000);
	return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}

/** Check if a name collides with any record in a list (excluding selfId). */
function nameTaken(name: string, records: AgentRecord[], selfId: string): boolean {
	const lower = name.toLowerCase();
	return records.some((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

/** Pick a unique name from cwd basename, suffixing if needed. */
function pickName(cwd: string, records: AgentRecord[], selfId: string): string {
	const base = basename(cwd) || "agent";
	if (!nameTaken(base, records, selfId)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!nameTaken(candidate, records, selfId)) return candidate;
	}
	return `${base}-${selfId.slice(0, 6)}`;
}

/** Format the peer list for error messages. */
function peerNames(records: AgentRecord[], selfId: string): string {
	const names = records.filter((r) => r.id !== selfId).map((r) => r.name);
	return names.length ? names.join(", ") : "(none)";
}

// ── Registry IO ─────────────────────────────────────────────────

function ensureDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

function writeRecord(record: AgentRecord): void {
	try {
		ensureDir();
		writeFileSync(
			join(REGISTRY_DIR, `${record.id}.json`),
			JSON.stringify(record, null, 2),
			"utf-8",
		);
	} catch { /* best-effort */ }
}

function removeRecord(id: string): void {
	try { unlinkSync(join(REGISTRY_DIR, `${id}.json`)); } catch { /* already gone */ }
}

function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Read all records, evicting dead entries and cleaning up stale sockets/maildirs. */
function readAllRecords(): AgentRecord[] {
	ensureDir();
	const now = Date.now();
	const records: AgentRecord[] = [];

	for (const file of readdirSync(REGISTRY_DIR)) {
		if (!file.endsWith(".json")) continue;
		const fullPath = join(REGISTRY_DIR, file);
		try {
			const record: AgentRecord = JSON.parse(readFileSync(fullPath, "utf-8"));
			// Backfill name for records from older extension versions
			if (!record.name) record.name = basename(record.cwd) || record.id.slice(0, 8);

			const cls = classifyRecord(record, now, isPidAlive(record.pid));
			if (cls === "dead") {
				unlinkSync(fullPath);
				// Clean up stale socket and maildir
				cleanupAgentFiles(record.id);
			} else {
				if (cls === "stalled") record.status = "stalled";
				records.push(record);
			}
		} catch {
			try { unlinkSync(fullPath); } catch { /* */ }
		}
	}

	return records;
}

/** Remove socket and maildir for an agent id. */
function cleanupAgentFiles(id: string): void {
	const sockPath = join(REGISTRY_DIR, `${id}.sock`);
	const maildirPath = join(REGISTRY_DIR, id);
	try { unlinkSync(sockPath); } catch { /* */ }
	try { rmSync(maildirPath, { recursive: true, force: true }); } catch { /* */ }
}

// ── Maildir IO ──────────────────────────────────────────────────

let maildirSeq = 0;

/** Write a single event file to the agent's Maildir. */
function maildirWrite(maildirPath: string, entry: MaildirEntry): void {
	try {
		if (!existsSync(maildirPath)) mkdirSync(maildirPath, { recursive: true });

		const seq = (maildirSeq++).toString().padStart(4, "0");
		const eventName = String(entry.event || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
		const filename = `${entry.ts}-${seq}-${eventName}.json`;
		writeFileSync(join(maildirPath, filename), JSON.stringify(entry), "utf-8");

		// Prune old entries
		maildirPrune(maildirPath, MAX_MAILDIR_ENTRIES);
	} catch { /* best-effort */ }
}

/** Keep only the last N files in the Maildir (sorted by name = by timestamp). */
function maildirPrune(maildirPath: string, keep: number): void {
	try {
		const files = readdirSync(maildirPath)
			.filter((f) => f.endsWith(".json"))
			.sort();
		if (files.length <= keep) return;
		const toRemove = files.slice(0, files.length - keep);
		for (const f of toRemove) {
			try { unlinkSync(join(maildirPath, f)); } catch { /* */ }
		}
	} catch { /* */ }
}

/** Read the last N entries from a Maildir directory. */
function maildirRead(maildirPath: string, count: number): MaildirEntry[] {
	try {
		if (!existsSync(maildirPath)) return [];
		const files = readdirSync(maildirPath)
			.filter((f) => f.endsWith(".json"))
			.sort();
		const recent = files.slice(-count);
		const entries: MaildirEntry[] = [];
		for (const f of recent) {
			try {
				entries.push(JSON.parse(readFileSync(join(maildirPath, f), "utf-8")));
			} catch { /* skip corrupt */ }
		}
		return entries;
	} catch {
		return [];
	}
}

/** Format Maildir entries as readable text for agent_peek output. */
function formatMaildirEntries(entries: MaildirEntry[]): string {
	if (entries.length === 0) return "(no activity recorded yet)";
	return entries.map((e) => {
		const ts = new Date(e.ts).toISOString().slice(11, 19);
		const event = e.event ?? "?";
		const rest = { ...e };
		delete rest.ts;
		delete rest.event;
		const extra = Object.keys(rest).length > 0
			? " " + Object.entries(rest).map(([k, v]) => {
				const val = typeof v === "string" ? v.slice(0, 120) : JSON.stringify(v)?.slice(0, 120) ?? "";
				return `${k}=${val}`;
			}).join(" ")
			: "";
		return `[${ts}] ${event}${extra}`;
	}).join("\n");
}

// ── Socket IO ───────────────────────────────────────────────────

/** Send a command to an agent's Unix socket. Returns the response. */
function socketSend(socketPath: string, cmd: SocketCommand): Promise<SocketResponse> {
	return new Promise((resolve, reject) => {
		const client = net.createConnection({ path: socketPath }, () => {
			// write + half-close: signals EOF so server's 'end' handler fires
			client.end(JSON.stringify(cmd) + "\n");
		});
		let buf = "";
		client.setTimeout(SOCKET_TIMEOUT_MS);
		client.on("data", (chunk) => { buf += chunk.toString(); });
		client.on("end", () => {
			try {
				resolve(JSON.parse(buf.trim()) as SocketResponse);
			} catch {
				resolve({ ok: false, error: "Invalid response from agent socket" });
			}
		});
		client.on("timeout", () => {
			client.destroy();
			reject(new Error("Socket timeout"));
		});
		client.on("error", (err) => {
			reject(new Error(`Socket error: ${err.message}`));
		});
	});
}

// ── Tmux IO ─────────────────────────────────────────────────────

async function findOwnTmuxPane(): Promise<string | undefined> {
	try {
		const pid = process.pid;
		const { stdout } = await execAsync(
			`tmux list-panes -a -F '#{pane_pid}\t#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null`,
		);
		for (const line of stdout.trim().split("\n")) {
			const [panePid, addr] = line.split("\t");
			if (!panePid || !addr) continue;
			try {
				const { stdout: tree } = await execAsync(
					`pgrep -P ${panePid} 2>/dev/null; pgrep -g $(pgrep -P ${panePid} 2>/dev/null | head -5 | tr '\\n' ',') 2>/dev/null || true`,
				);
				if (tree.trim().split("\n").map(Number).includes(pid)) return addr;
			} catch { continue; }
		}
	} catch { /* not in tmux */ }
	return undefined;
}

async function sendToPane(target: string, message: string): Promise<void> {
	const escaped = message.replace(/'/g, "'\\''");
	await execAsync(`tmux send-keys -t ${target} '${escaped}' Enter`);
}

// ── Name resolution ─────────────────────────────────────────────

function resolveByName(name: string, selfId: string): AgentRecord | undefined {
	const lower = name.toLowerCase();
	return readAllRecords().find((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

/** Resolve target to transport info. Returns tmux OR socket OR maildir path. */
function resolveTarget(
	raw: string,
	selfId: string,
): { tmux?: string; socket?: string; maildirPath?: string; name?: string; id?: string } {
	// Direct tmux address
	if (/^[\w-]+:\d+\.\d+$/.test(raw)) return { tmux: raw };

	const peer = resolveByName(raw, selfId);
	if (!peer) {
		throw new Error(
			`No agent named "${raw}". Known peers: ${peerNames(readAllRecords(), selfId)}`,
		);
	}

	if (peer.tmux) return { tmux: peer.tmux, name: peer.name, id: peer.id };

	// Non-tmux: use socket for sending, maildir for peeking
	const socket = peer.socket ?? join(REGISTRY_DIR, `${peer.id}.sock`);
	const maildirPath = join(REGISTRY_DIR, peer.id);
	return { socket, maildirPath, name: peer.name, id: peer.id };
}

// ── Widget rendering ────────────────────────────────────────────

function renderWidget(records: AgentRecord[], selfId: string, theme: ExtensionContext["ui"]["theme"]): string[] {
	const sorted = [...records].sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return a.startedAt - b.startedAt;
	});

	return sorted.map((rec) => {
		const marker = rec.id === selfId ? theme.fg("accent", "●") : theme.fg("dim", "○");
		const sym = STATUS_SYMBOL[rec.status];
		const done = existsSync(join(rec.cwd, "REPORT.md")) ? " ☑" : "";
		const transport = rec.tmux
			? theme.fg("dim", ` ${rec.tmux}`)
			: rec.socket
				? theme.fg("dim", " ⚡sock")
				: "";
		const task = rec.task ? theme.fg("dim", ` ${rec.task.slice(0, 40)}`) : "";
		return `${marker} ${sym} ${theme.fg("success", rec.name)}${transport}${done}${task}`;
	});
}

function refreshWidget(ctx: ExtensionContext, selfId: string): void {
	try {
		const records = readAllRecords();
		if (records.length === 0) {
			ctx.ui.setWidget("agent-panopticon", undefined);
			ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("dim", "agents: 0"));
			return;
		}

		ctx.ui.setWidget("agent-panopticon", renderWidget(records, selfId, ctx.ui.theme), {
			placement: "belowEditor",
		});

		const others = records.length - 1;
		const label = others === 0 ? "just you" : `${others} peer${others !== 1 ? "s" : ""}`;
		ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("accent", label));
	} catch {
		ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("error", "agents: err"));
	}
}

// ── Tool result helpers ─────────────────────────────────────────

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const selfId = `${process.pid}-${Date.now().toString(36)}`;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let widgetTimer: ReturnType<typeof setInterval> | null = null;
	let status: AgentStatus = "waiting";
	let task: string | undefined;
	let record: AgentRecord | undefined;

	// Maildir + Socket paths for this agent
	const selfMaildir = join(REGISTRY_DIR, selfId);
	const selfSocketPath = join(REGISTRY_DIR, `${selfId}.sock`);
	let socketServer: net.Server | null = null;

	function heartbeat(): void {
		if (!record) return;
		record = buildRecord(record, status, task);
		writeRecord(record);
	}

	function clearTimers(): void {
		if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
		if (widgetTimer) { clearInterval(widgetTimer); widgetTimer = null; }
	}

	/** Write an event to this agent's Maildir. */
	function emit(event: string, data: Record<string, unknown> = {}): void {
		maildirWrite(selfMaildir, { ts: Date.now(), event, ...data });
	}

	/** Start the Unix domain socket server for receiving messages. */
	function startSocket(): void {
		try {
			// Clean up stale socket file if it exists
			if (existsSync(selfSocketPath)) {
				try { unlinkSync(selfSocketPath); } catch { /* */ }
			}

			socketServer = net.createServer({ allowHalfOpen: true }, (conn) => {
				let buf = "";
				conn.setTimeout(SOCKET_TIMEOUT_MS);
				conn.on("data", (chunk) => {
					buf += chunk.toString();
					// Process as soon as we have a complete line (newline-delimited)
					const nlIdx = buf.indexOf("\n");
					if (nlIdx !== -1) {
						const line = buf.slice(0, nlIdx).trim();
						buf = buf.slice(nlIdx + 1);
						try {
							const cmd = JSON.parse(line) as SocketCommand;
							handleSocketCommand(cmd, conn);
						} catch {
							conn.end(JSON.stringify({ ok: false, error: "Invalid JSON" }) + "\n");
						}
					}
				});
				conn.on("timeout", () => conn.destroy());
				conn.on("error", () => { /* client disconnect, ignore */ });
			});

			socketServer.listen(selfSocketPath, () => {
				// Socket is ready
			});
			socketServer.on("error", () => {
				// Socket failed to bind — non-fatal, tmux/maildir still work
				socketServer = null;
			});
			// Don't keep process alive just for the socket
			socketServer.unref();
		} catch {
			socketServer = null;
		}
	}

	/** Handle an incoming socket command. */
	function handleSocketCommand(cmd: SocketCommand, conn: net.Socket): void {
		switch (cmd.type) {
			case "message": {
				const from = cmd.from ?? "unknown";
				const text = cmd.text ?? "";
				if (!text) {
					conn.end(JSON.stringify({ ok: false, error: "Empty message" }) + "\n");
					return;
				}
				// Inject message into this agent's conversation
				try {
					pi.sendUserMessage(`[from ${from}]: ${text}`, { deliverAs: "followUp" });
					emit("message_received", { from, text: text.slice(0, 200) });
					conn.end(JSON.stringify({ ok: true }) + "\n");
				} catch (err) {
					conn.end(JSON.stringify({ ok: false, error: String(err) }) + "\n");
				}
				break;
			}
			case "peek": {
				const lines = cmd.lines ?? 50;
				const entries = maildirRead(selfMaildir, lines);
				conn.end(JSON.stringify({ ok: true, entries }) + "\n");
				break;
			}
			default:
				conn.end(JSON.stringify({ ok: false, error: `Unknown command: ${(cmd as any).type}` }) + "\n");
		}
	}

	/** Stop the socket server and clean up the socket file. */
	function stopSocket(): void {
		if (socketServer) {
			try { socketServer.close(); } catch { /* */ }
			socketServer = null;
		}
		try { unlinkSync(selfSocketPath); } catch { /* */ }
	}

	// ── Lifecycle ───────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		const tmux = await findOwnTmuxPane();
		const records = readAllRecords();

		try {
			if (existsSync(join(process.cwd(), "BRIEF.md"))) {
				const brief = readFileSync(join(process.cwd(), "BRIEF.md"), "utf-8");
				const line = brief.split("\n").find((l) => l.trim() && !l.startsWith("#"));
				if (line) task = line.trim();
			}
		} catch { /* */ }

		// Start socket server for IPC
		startSocket();

		record = {
			id: selfId,
			name: pickName(process.cwd(), records, selfId),
			pid: process.pid,
			cwd: process.cwd(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			tmux,
			socket: selfSocketPath,
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting",
			task,
		};

		writeRecord(record);
		heartbeatTimer = setInterval(() => heartbeat(), HEARTBEAT_MS);

		emit("session_start", {
			name: record.name,
			pid: process.pid,
			cwd: process.cwd(),
			model: record.model,
			tmux: tmux ?? null,
		});

		if (ctx.hasUI) {
			refreshWidget(ctx, selfId);
			widgetTimer = setInterval(() => refreshWidget(ctx, selfId), HEARTBEAT_MS);
		}
	});

	pi.on("agent_start", async () => {
		status = "running";
		heartbeat();
		emit("agent_start", { status: "running", task });
	});

	pi.on("agent_end", async () => {
		status = "waiting";
		heartbeat();
		emit("agent_end", { status: "waiting" });
	});

	pi.on("tool_call", async (event) => {
		const argsPreview = JSON.stringify(event.input ?? {}).slice(0, 200);
		emit("tool_call", { tool: event.toolName, args: argsPreview });
	});

	pi.on("tool_result", async (event) => {
		const summary = (event.content ?? [])
			.map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : `[${c.type}]`))
			.join(" ")
			.slice(0, 200);
		emit("tool_result", { tool: event.toolName, summary, isError: event.isError });
	});

	pi.on("model_select", async (event) => {
		if (record) {
			record.model = `${event.model.provider}/${event.model.id}`;
			heartbeat();
		}
	});

	pi.on("input", async (event) => {
		if (!task && event.text) {
			task = event.text.split("\n")[0]?.slice(0, 80);
			heartbeat();
		}
		return { action: "continue" as const };
	});

	pi.on("session_shutdown", async () => {
		clearTimers();
		stopSocket();
		removeRecord(selfId);
		// Clean up maildir
		try { rmSync(selfMaildir, { recursive: true, force: true }); } catch { /* */ }
	});

	// ── /alias command ──────────────────────────────────────────

	pi.registerCommand("alias", {
		description: "Set your agent name. Usage: /alias <name>",
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				ctx.ui.notify(`Current name: ${record?.name ?? "(none)"}`, "info");
				return;
			}
			if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
				ctx.ui.notify("Name must start with alphanumeric, then alphanumeric/hyphens/dots/underscores", "warning");
				return;
			}
			if (nameTaken(name, readAllRecords(), selfId)) {
				ctx.ui.notify(`Name "${name}" is already taken`, "warning");
				return;
			}
			if (record) {
				record.name = name;
				heartbeat();
				ctx.ui.notify(`You are now "${name}"`, "info");
			}
		},
	});

	// ── /agents command ─────────────────────────────────────────

	pi.registerCommand("agents", {
		description: "Show all registered agents",
		handler: async (_args, ctx) => {
			const summary = readAllRecords().map((r) =>
				`${STATUS_SYMBOL[r.status]} ${r.name}${r.id === selfId ? " (you)" : ""}`,
			);
			ctx.ui.notify(summary.join("  "), "info");
		},
	});

	// ── /send command ───────────────────────────────────────────

	pi.registerCommand("send", {
		description: "Send a message to a named agent. Usage: /send <name> <message>",
		handler: async (args, ctx) => {
			const match = args?.match(/^(\S+)\s+(.+)$/s);
			if (!match?.[1] || !match[2]) {
				ctx.ui.notify("Usage: /send <name> <message>", "warning");
				return;
			}
			try {
				const resolved = resolveTarget(match[1], selfId);
				if (resolved.tmux) {
					await sendToPane(resolved.tmux, match[2]);
				} else if (resolved.socket) {
					await socketSend(resolved.socket, {
						type: "message",
						from: record?.name ?? "unknown",
						text: match[2],
					});
				} else {
					ctx.ui.notify(`No transport available for "${match[1]}"`, "error");
					return;
				}
				ctx.ui.notify(`→ ${match[1]}: ${match[2].slice(0, 50)}${match[2].length > 50 ? "…" : ""}`, "info");
			} catch (err) {
				ctx.ui.notify(`${err}`, "error");
			}
		},
	});

	// ── agent_peek tool ─────────────────────────────────────────

	pi.registerTool({
		name: "agent_peek",
		label: "Agent Peek",
		description:
			"List agents discovered in the shared registry, or read the activity log of a specific agent. " +
			"With no target: returns all registered agents and their status. " +
			"With a target (agent name): reads the agent's Maildir activity log or captures tmux pane output if available.",
		promptSnippet: "Discover agents or read a specific agent's activity log",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({ description: "Agent name to inspect. Omit to list all agents." }),
			),
			lines: Type.Optional(
				Type.Number({ description: "Number of lines to capture from the pane (default 50)", default: 50 }),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			if (!params.target) {
				const records = readAllRecords();
				if (records.length === 0) return textResult("No agents registered.", { agents: [] });

				const listing = records.map((r) => {
					const transport = r.socket ? "⚡socket" : r.tmux ? r.tmux : "no-transport";
					const self = r.id === selfId ? " (you)" : "";
					const done = existsSync(join(r.cwd, "REPORT.md")) ? " ☑ done" : "";
					const taskStr = r.task ? `  "${r.task.slice(0, 50)}"` : "";
					return `  ${STATUS_SYMBOL[r.status]} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${transport.padEnd(12)} ${r.model || "?"} up=${formatAge(r.startedAt)}${self}${done}${taskStr}`;
				});

				return textResult(
					`${records.length} registered agent(s):\n${listing.join("\n")}\n\nUse agent_peek with an agent name to read their activity.\nUse agent_send to message a peer.`,
					{ agents: records.map((r) => ({ name: r.name, pid: r.pid, socket: r.socket, cwd: r.cwd, status: r.status, model: r.model, task: r.task, isSelf: r.id === selfId })) },
				);
			}

			const resolved = resolveTarget(params.target.replace(/^@/, ""), selfId);
			const lineCount = params.lines ?? 50;

			// Primary: read Maildir entries (works for all agents)
			const maildirPath = resolved.maildirPath ?? (resolved.id ? join(REGISTRY_DIR, resolved.id) : undefined);
			if (maildirPath && existsSync(maildirPath)) {
				const entries = maildirRead(maildirPath, lineCount);
				const content = formatMaildirEntries(entries);
				const label = resolved.name ?? params.target;
				return textResult(
					`Agent "${label}" activity (last ${entries.length} events):\n\n${content}`,
					{ target: label, transport: "maildir", events: entries.length },
				);
			}

			// Fallback: try tmux if available
			if (resolved.tmux) {
				try {
					const { stdout } = await execAsync(`tmux capture-pane -t ${resolved.tmux} -p -S -${lineCount} 2>/dev/null`);
					const content = stdout.trimEnd();
					if (content) {
						return textResult(
							`Agent "${resolved.name ?? params.target}" (tmux fallback, last ${lineCount} lines):\n\n${content}`,
							{ target: resolved.tmux, lines: content.split("\n").length, transport: "tmux" },
						);
					}
				} catch { /* tmux not available */ }
			}

			return textResult(`Agent "${params.target}" has no activity log yet.`, {});
		},
	});

	// ── agent_send tool ─────────────────────────────────────────

	pi.registerTool({
		name: "agent_send",
		label: "Agent Send",
		description:
			"Send a message to a named peer agent. Resolves the name from the registry " +
			"and delivers the message via Unix socket IPC. " +
			"Use agent_peek first to see available agents.",
		promptSnippet: "Send a message to a named peer agent",
		promptGuidelines: [
			"Use agent_peek (no target) first to discover peers before sending.",
			"After agent_send, wait a moment then agent_peek the same name to read the reply.",
			"Do not send to yourself.",
		],
		parameters: Type.Object({
			name: Type.String({ description: 'Agent name (e.g. "alice", "api-builder")' }),
			message: Type.String({ description: "Message to send" }),
		}),

		async execute(_toolCallId, params, _signal) {
			const resolved = resolveTarget(params.name, selfId);
			const preview = params.message.slice(0, 200) + (params.message.length > 200 ? "…" : "");

			// Primary: Unix socket
			const sockPath = resolved.socket ?? (resolved.id ? join(REGISTRY_DIR, `${resolved.id}.sock`) : undefined);
			if (sockPath && existsSync(sockPath)) {
				try {
					const resp = await socketSend(sockPath, {
						type: "message",
						from: record?.name ?? "unknown",
						text: params.message,
					});
					if (!resp.ok) {
						return textResult(
							`Agent "${params.name}" rejected the message: ${resp.error ?? "unknown error"}`,
							{ name: params.name, transport: "socket", error: resp.error },
						);
					}
					return textResult(
						`Sent to ${params.name}: ${preview}\n\nMessage delivered. Use agent_peek "${params.name}" to see their activity.`,
						{ name: params.name, transport: "socket", messageLength: params.message.length },
					);
				} catch (err) {
					// Socket failed — try tmux fallback
					if (resolved.tmux) {
						try {
							await sendToPane(resolved.tmux, params.message);
							return textResult(
								`Sent to ${params.name} (tmux fallback): ${preview}\n\nUse agent_peek "${params.name}" to read the response.`,
								{ name: params.name, transport: "tmux", messageLength: params.message.length },
							);
						} catch { /* tmux also failed */ }
					}
					return textResult(
						`Failed to reach agent "${params.name}": ${err}\n\nThe agent may be busy or unresponsive.`,
						{ name: params.name, error: String(err) },
					);
				}
			}

			// Fallback: try tmux if socket not available
			if (resolved.tmux) {
				try {
					await sendToPane(resolved.tmux, params.message);
					return textResult(
						`Sent to ${params.name} (tmux fallback): ${preview}\n\nUse agent_peek "${params.name}" to read the response.`,
						{ name: params.name, transport: "tmux", messageLength: params.message.length },
					);
				} catch { /* tmux also failed */ }
			}

			return textResult(`Agent "${params.name}" is unreachable. No socket or tmux pane available.`, {});
		},
	});
}
