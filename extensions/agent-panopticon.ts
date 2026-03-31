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
 * - Tools to peek at agent activity and send messages
 *
 * Registry: ~/.pi/agents/{id}.json
 * - Written by each agent on session_start
 * - Heartbeat every 5s with updated status
 * - Removed on session_shutdown
 * - Stale entries (>30s no heartbeat) cleaned by readers
 *
 * Transport:
 * 1. Unix socket — direct message delivery via pi.sendUserMessage()
 * 2. Maildir     — passive progress observation for agent_peek
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

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Container, Text, type SelectItem, SelectList, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
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

// ── Types ───────────────────────────────────────────────────────

type AgentStatus = "running" | "waiting" | "done" | "blocked" | "stalled" | "terminated" | "unknown";

interface AgentRecord {
	id: string;
	name: string;
	pid: number;
	cwd: string;
	model: string;
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

/**
 * Socket protocol — Erlang-inspired messaging primitives:
 *
 * cast    — async fire-and-forget message (no response expected by sender,
 *           but we still reply {ok:true} for delivery confirmation)
 * call    — sync request/response (sender blocks until reply)
 * peek    — read activity log (convenience alias for call)
 */
interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	lines?: number;
	// call-specific
	ref?: string;          // correlation id for call responses
	command?: string;      // sub-command for call (e.g. "get_status")
	payload?: unknown;     // arbitrary data for call
	// Legacy compat
}

interface SocketResponse {
	ok: boolean;
	ref?: string;
	error?: string;
	entries?: MaildirEntry[];
	data?: unknown;
}

// ── Constants ───────────────────────────────────────────────────

const REGISTRY_DIR = join(homedir(), ".pi", "agents");
const HEARTBEAT_MS = 5_000;
const STALE_MS = 30_000;
const MAX_MAILDIR_ENTRIES = 200;
const SOCKET_TIMEOUT_MS = 3_000;

const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "🟢",   // active — agent turn in progress
	waiting: "🟡",   // idle — awaiting input
	done: "✅",      // completed — REPORT.md exists
	blocked: "🚧",   // needs attention — idle, might need human
	stalled: "🛑",   // stalled/timeout — heartbeat aging or error
	terminated: "⚫", // dead — PID gone
	unknown: "⚪",   // can't determine
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
	// Refine status based on REPORT.md presence when idle
	let refined = status;
	if (status === "waiting") {
		try {
			if (existsSync(join(base.cwd, "REPORT.md"))) {
				refined = "done";
			}
		} catch { /* best-effort */ }
	}
	return { ...base, heartbeat: Date.now(), status: refined, task };
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

// ── Name resolution ─────────────────────────────────────────────

function resolveByName(name: string, selfId: string): AgentRecord | undefined {
	const lower = name.toLowerCase();
	return readAllRecords().find((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

/** Resolve target to socket + maildir paths. */
function resolveTarget(
	raw: string,
	selfId: string,
): { socket?: string; maildirPath?: string; name?: string; id?: string } {
	const peer = resolveByName(raw, selfId);
	if (!peer) {
		throw new Error(
			`No agent named "${raw}". Known peers: ${peerNames(readAllRecords(), selfId)}`,
		);
	}

	const socket = peer.socket ?? join(REGISTRY_DIR, `${peer.id}.sock`);
	const maildirPath = join(REGISTRY_DIR, peer.id);
	return { socket, maildirPath, name: peer.name, id: peer.id };
}

// ── Powerline characters ────────────────────────────────────────

const PL_SEP_THIN = "\uE0B1"; // Powerline thin right arrow

// ── Widget rendering (Powerline compact view) ───────────────────

/** Sort records: self first, then by startedAt. */
function sortRecords(records: AgentRecord[], selfId: string): AgentRecord[] {
	return [...records].sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return a.startedAt - b.startedAt;
	});
}

/** Build a single powerline-style status line showing all agents as colored segments. */
function renderPowerlineWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const sorted = sortRecords(records, selfId);

	// Build compact segments: status_icon name
	const segments = sorted.map((rec) => {
		const isSelf = rec.id === selfId;
		const sym = STATUS_SYMBOL[rec.status];
		const name = rec.name;

		// Transport indicator: ⚡ = socket (can message), ○ = no transport
		const transport = isSelf ? "" : (rec.socket ? theme.fg("dim", "⚡") : theme.fg("error", "○"));

		if (isSelf) {
			return `${sym} ${theme.fg("accent", theme.bold(name))}`;
		} else {
			const nameStr = rec.status === "running"
				? theme.fg("success", name)
				: rec.status === "stalled" || rec.status === "blocked"
					? theme.fg("warning", name)
					: rec.status === "done"
						? theme.fg("dim", name)
						: theme.fg("muted", name);
			return `${sym} ${transport}${nameStr}`;
		}
	});

	// Join with thin powerline separators
	const separator = theme.fg("dim", ` ${PL_SEP_THIN} `);
	const line = segments.join(separator);

	return [truncateToWidth(line, availableWidth)];
}

function refreshWidget(ctx: ExtensionContext, selfId: string): void {
	try {
		const records = readAllRecords();
		if (records.length === 0) {
			ctx.ui.setWidget("agent-panopticon", undefined);
			ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("dim", "agents: 0"));
			return;
		}

		// Powerline compact widget
		ctx.ui.setWidget("agent-panopticon", (_tui, theme) => {
			return {
				render(width: number): string[] {
					return renderPowerlineWidget(readAllRecords(), selfId, theme, width);
				},
				invalidate(): void { /* re-render fetches fresh data */ },
			};
		}, { placement: "belowEditor" });

		// Compact status in footer
		const running = records.filter(r => r.status === "running" && r.id !== selfId).length;
		const waiting = records.filter(r => r.status === "waiting" && r.id !== selfId).length;
		const total = records.length - 1;
		let label: string;
		if (total === 0) {
			label = "solo";
		} else {
			const parts: string[] = [];
			if (running > 0) parts.push(`${running}▶`);
			if (waiting > 0) parts.push(`${waiting}⏸`);
			label = parts.length > 0 ? parts.join(" ") : `${total} peer${total !== 1 ? "s" : ""}`;
		}
		ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("accent", `⚡${label}`));
	} catch {
		ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("error", "agents: err"));
	}
}

// ── Agent detail overlay ────────────────────────────────────────

/** Open an interactive overlay showing all agents with details and activity logs. */
async function openAgentOverlay(
	ctx: ExtensionCommandContext,
	selfId: string,
	selfRecord: AgentRecord | undefined,
): Promise<void> {
	const records = readAllRecords();
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		return;
	}

	const sorted = sortRecords(records, selfId);

	// Build select items with rich detail
	const items: SelectItem[] = sorted.map((rec) => {
		const sym = STATUS_SYMBOL[rec.status];
		const isSelf = rec.id === selfId;
		const transport = rec.socket ? "⚡socket" : "no-transport";
		const age = formatAge(rec.startedAt);
		const model = rec.model || "?";
		const selfTag = isSelf ? " (you)" : "";

		const description = `${rec.status} │ ${transport} │ ${model} │ up ${age}`
			+ (rec.task ? ` │ ${rec.task.slice(0, 50)}` : "");

		return {
			value: rec.name,
			label: `${sym} ${rec.name}${selfTag}`,
			description,
		};
	});

	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Title
		container.addChild(new Text(
			theme.fg("accent", theme.bold(" Agent Panopticon")) +
			theme.fg("dim", ` — ${records.length} agent${records.length !== 1 ? "s" : ""}`),
			1, 0,
		));

		// SelectList
		const selectList = new SelectList(items, Math.min(items.length, 12), {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		});
		selectList.onSelect = (item) => done(item.value);
		selectList.onCancel = () => done(null);
		container.addChild(selectList);

		// Help text
		container.addChild(new Text(
			theme.fg("dim", "  ↑↓ navigate • enter view detail • esc close"),
			1, 0,
		));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
		};
	});

	if (!selected) return;

	// Show detail view for selected agent
	await showAgentDetail(ctx, selfId, selfRecord, selected);
}

/** Show detailed view for a specific agent with activity log. */
async function showAgentDetail(
	ctx: ExtensionCommandContext,
	selfId: string,
	selfRecord: AgentRecord | undefined,
	agentName: string,
): Promise<void> {
	const records = readAllRecords();
	const rec = records.find(r => r.name.toLowerCase() === agentName.toLowerCase());
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === selfId;

	// Read activity log
	const maildirPath = join(REGISTRY_DIR, rec.id);
	const entries = maildirRead(maildirPath, 20);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		// Agent header
		const sym = STATUS_SYMBOL[rec.status];
		const selfTag = isSelf ? theme.fg("dim", " (you)") : "";
		container.addChild(new Text(
			`  ${sym} ${theme.fg("accent", theme.bold(rec.name))}${selfTag}  ${theme.fg("muted", rec.status)}`,
			1, 0,
		));

		// Details grid
		const details = [
			["Model", rec.model || "unknown"],
			["CWD", rec.cwd],
			["PID", String(rec.pid)],
			["Transport", rec.socket ? "⚡ Unix socket" : "none"],
			["Uptime", formatAge(rec.startedAt)],
			["REPORT.md", existsSync(join(rec.cwd, "REPORT.md")) ? "☑ exists" : "—"],
		];
		if (rec.task) details.push(["Task", rec.task.slice(0, 60)]);

		for (const [label, value] of details) {
			container.addChild(new Text(
				`  ${theme.fg("dim", label.padEnd(12))} ${theme.fg("text", value)}`,
				1, 0,
			));
		}

		// Activity log
		container.addChild(new Text(
			`\n  ${theme.fg("accent", theme.bold("Recent Activity"))} ${theme.fg("dim", `(${entries.length} events)`)}`,
			1, 0,
		));

		if (entries.length === 0) {
			container.addChild(new Text(
				`  ${theme.fg("dim", "(no activity recorded)")}`,
				1, 0,
			));
		} else {
			for (const entry of entries.slice(-15)) {
				const ts = new Date(entry.ts).toISOString().slice(11, 19);
				const event = String(entry.event ?? "?");
				const extra: string[] = [];
				for (const [k, v] of Object.entries(entry)) {
					if (k === "ts" || k === "event") continue;
					const val = typeof v === "string" ? v.slice(0, 60) : JSON.stringify(v)?.slice(0, 60) ?? "";
					extra.push(`${k}=${val}`);
				}
				const extraStr = extra.length > 0 ? " " + extra.join(" ") : "";

				const eventColor = event.includes("error") ? "error"
					: event.includes("start") ? "success"
					: event.includes("end") ? "warning"
					: "dim";

				container.addChild(new Text(
					`  ${theme.fg("dim", ts)} ${theme.fg(eventColor as any, event)}${theme.fg("muted", extraStr)}`,
					1, 0,
				));
			}
		}

		// Help text
		const helpParts = ["esc back"];
		if (!isSelf) helpParts.push("m send message");
		container.addChild(new Text(
			`\n  ${theme.fg("dim", helpParts.join(" • "))}`,
			1, 0,
		));

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					// Close overlay and prompt for message
					done();
					// After overlay closes, the /send command can be used
					ctx.ui.setEditorText(`/send ${rec.name} `);
				}
			},
		};
	});
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
			if (existsSync(selfSocketPath)) {
				try { unlinkSync(selfSocketPath); } catch { /* */ }
			}

			socketServer = net.createServer({ allowHalfOpen: true }, (conn) => {
				let buf = "";
				conn.setTimeout(SOCKET_TIMEOUT_MS);
				conn.on("data", (chunk) => {
					buf += chunk.toString();
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

			socketServer.listen(selfSocketPath, () => { /* ready */ });
			socketServer.on("error", () => { socketServer = null; });
			socketServer.unref();
		} catch {
			socketServer = null;
		}
	}

	/** Handle an incoming socket command. */
	function handleSocketCommand(cmd: SocketCommand, conn: net.Socket): void {
		// Legacy compat: treat "message" as "cast"
		const type = (cmd as any).type === "message" ? "cast" : cmd.type;

		switch (type) {
			// ── cast: async fire-and-forget message ──────────────
			case "cast": {
				const from = cmd.from ?? "unknown";
				const text = cmd.text ?? "";
				if (!text) {
					conn.end(JSON.stringify({ ok: false, error: "Empty message" }) + "\n");
					return;
				}
				try {
					pi.sendUserMessage(`[from ${from}]: ${text}`, { deliverAs: "followUp" });
					emit("cast_received", { from, text: text.slice(0, 200) });
					conn.end(JSON.stringify({ ok: true }) + "\n");
				} catch (err) {
					conn.end(JSON.stringify({ ok: false, error: String(err) }) + "\n");
				}
				break;
			}

			// ── call: sync request/response ──────────────────────
			case "call": {
				const ref = cmd.ref;
				const subCmd = cmd.command ?? "get_status";

				switch (subCmd) {
					case "get_status": {
						conn.end(JSON.stringify({
							ok: true, ref,
							data: {
								name: record?.name,
								status,
								task,
								model: record?.model,
								uptime: record ? Date.now() - record.startedAt : 0,
								pid: process.pid,
							},
						}) + "\n");
						break;
					}
					case "peek": {
						const lines = (cmd.payload as any)?.lines ?? cmd.lines ?? 50;
						const entries = maildirRead(selfMaildir, lines);
						conn.end(JSON.stringify({ ok: true, ref, entries }) + "\n");
						break;
					}
					case "ping": {
						conn.end(JSON.stringify({ ok: true, ref, data: "pong" }) + "\n");
						break;
					}
					default:
						conn.end(JSON.stringify({ ok: false, ref, error: `Unknown call command: ${subCmd}` }) + "\n");
				}
				break;
			}

			// ── peek: shorthand for call/peek ─────────────────────
			case "peek": {
				const lines = cmd.lines ?? 50;
				const entries = maildirRead(selfMaildir, lines);
				conn.end(JSON.stringify({ ok: true, entries }) + "\n");
				break;
			}

			default:
				conn.end(JSON.stringify({ ok: false, error: `Unknown command: ${type}` }) + "\n");
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
		const records = readAllRecords();

		try {
			if (existsSync(join(process.cwd(), "BRIEF.md"))) {
				const brief = readFileSync(join(process.cwd(), "BRIEF.md"), "utf-8");
				const line = brief.split("\n").find((l) => l.trim() && !l.startsWith("#"));
				if (line) task = line.trim();
			}
		} catch { /* */ }

		startSocket();

		record = {
			id: selfId,
			name: pickName(process.cwd(), records, selfId),
			pid: process.pid,
			cwd: process.cwd(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
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
		description: "Open agent panopticon overlay — browse all agents, view details & activity",
		handler: async (_args, ctx) => {
			await openAgentOverlay(ctx, selfId, record);
		},
	});

	// ── Keyboard shortcut ──────────────────────────────────────

	pi.registerShortcut("ctrl+shift+o", {
		description: "Open agent panopticon overlay",
		handler: async (ctx) => {
			await openAgentOverlay(ctx as unknown as ExtensionCommandContext, selfId, record);
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
				if (!resolved.socket) {
					ctx.ui.notify(`No socket available for "${match[1]}"`, "error");
					return;
				}
				await socketSend(resolved.socket, {
					type: "cast",
					from: record?.name ?? "unknown",
					text: match[2],
				});
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
			"With a target (agent name): reads the agent's activity log.",
		promptSnippet: "Discover agents or read a specific agent's activity log",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({ description: "Agent name to inspect. Omit to list all agents." }),
			),
			lines: Type.Optional(
				Type.Number({ description: "Number of events to read (default 50)", default: 50 }),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			if (!params.target) {
				const records = readAllRecords();
				if (records.length === 0) return textResult("No agents registered.", { agents: [] });

				const listing = records.map((r) => {
					const transport = r.socket ? "⚡socket" : "no-socket";
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

			return textResult(`Agent "${params.target}" has no activity log yet.`, {});
		},
	});

	// ── agent_send tool (cast — async fire-and-forget) ─────────────

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

			const sockPath = resolved.socket;
			if (!sockPath || !existsSync(sockPath)) {
				return textResult(
					`Agent "${params.name}" has no socket. The agent may not be running or may need to be restarted.`,
					{ name: params.name, error: "no_socket" },
				);
			}

			try {
				const resp = await socketSend(sockPath, {
					type: "cast",
					from: record?.name ?? "unknown",
					text: params.message,
				});
				if (!resp.ok) {
					return textResult(
						`Agent "${params.name}" rejected: ${resp.error ?? "unknown error"}`,
						{ name: params.name, error: resp.error },
					);
				}
				return textResult(
					`→ ${params.name}: ${preview}`,
					{ name: params.name, pattern: "cast", messageLength: params.message.length },
				);
			} catch (err) {
				return textResult(
					`Failed to reach "${params.name}": ${err}`,
					{ name: params.name, error: String(err) },
				);
			}
		},
	});

	// ── agent_broadcast tool (fan out to all/filtered peers) ───

	pi.registerTool({
		name: "agent_broadcast",
		label: "Agent Broadcast",
		description:
			"Broadcast a message to all registered agents (or a filtered subset). " +
			"Each agent receives the message as an async cast via their socket.",
		promptSnippet: "Broadcast a message to all registered agents",
		parameters: Type.Object({
			message: Type.String({ description: "Message to broadcast" }),
			filter: Type.Optional(
				Type.String({ description: 'Filter agents by name pattern (substring match). Omit for all peers.' }),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const records = readAllRecords().filter((r) => r.id !== selfId);
			const targets = params.filter
				? records.filter((r) => r.name.toLowerCase().includes(params.filter!.toLowerCase()))
				: records;

			if (targets.length === 0) {
				return textResult(
					params.filter ? `No agents matching "${params.filter}".` : "No peer agents registered.",
					{ sent: 0 },
				);
			}

			const from = record?.name ?? "unknown";
			const results: { name: string; ok: boolean; error?: string }[] = [];

			for (const target of targets) {
				const sockPath = target.socket ?? join(REGISTRY_DIR, `${target.id}.sock`);
				if (!existsSync(sockPath)) {
					results.push({ name: target.name, ok: false, error: "no socket" });
					continue;
				}
				try {
					const resp = await socketSend(sockPath, { type: "cast", from, text: params.message });
					results.push({ name: target.name, ok: resp.ok, error: resp.error });
				} catch (err) {
					results.push({ name: target.name, ok: false, error: String(err) });
				}
			}

			const sent = results.filter((r) => r.ok).length;
			const summary = results.map((r) => `  ${r.ok ? "✓" : "✗"} ${r.name}${r.error ? ` (${r.error})` : ""}`).join("\n");

			return textResult(
				`Broadcast to ${targets.length} agent(s), ${sent} delivered:\n${summary}`,
				{ pattern: "broadcast", sent, failed: results.length - sent, targets: targets.map((t) => t.name) },
			);
		},
	});
}
