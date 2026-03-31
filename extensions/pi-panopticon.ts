/**
 * Pi Panopticon — Agent Registry & Monitoring
 *
 * Central observation point for all running pi agents.
 * Every pi instance registers itself on startup and heartbeats its status.
 *
 * Responsibilities (monitoring ONLY):
 * - Agent registry: ~/.pi/agents/{id}.json
 * - Heartbeat & status tracking
 * - Maildir activity log
 * - Unix socket server for receiving messages
 * - agent_peek tool (discover agents, read activity)
 * - Powerline compact widget
 * - /agents overlay + /alias command
 *
 * Does NOT provide: messaging (see pi-messaging.ts), spawning (see pi-subagent.ts)
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

interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	lines?: number;
	ref?: string;
	command?: string;
	payload?: unknown;
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

const PL_SEP_THIN = "\uE0B1";

// ── Pure functions ──────────────────────────────────────────────

function classifyRecord(record: AgentRecord, now: number, pidAlive: boolean): "live" | "stalled" | "dead" {
	if (now - record.heartbeat <= STALE_MS) return "live";
	return pidAlive ? "stalled" : "dead";
}

function buildRecord(base: AgentRecord, status: AgentStatus, task: string | undefined): AgentRecord {
	let refined = status;
	if (status === "waiting") {
		try {
			if (existsSync(join(base.cwd, "REPORT.md"))) refined = "done";
		} catch { /* best-effort */ }
	}
	return { ...base, heartbeat: Date.now(), status: refined, task };
}

function formatAge(startedAt: number): string {
	const secs = Math.round((Date.now() - startedAt) / 1000);
	return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}

function nameTaken(name: string, records: AgentRecord[], selfId: string): boolean {
	const lower = name.toLowerCase();
	return records.some((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

function pickName(cwd: string, records: AgentRecord[], selfId: string): string {
	const base = basename(cwd) || "agent";
	if (!nameTaken(base, records, selfId)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!nameTaken(candidate, records, selfId)) return candidate;
	}
	return `${base}-${selfId.slice(0, 6)}`;
}

// ── Registry IO ─────────────────────────────────────────────────

function ensureDir(): void {
	if (!existsSync(REGISTRY_DIR)) mkdirSync(REGISTRY_DIR, { recursive: true });
}

function writeRecord(record: AgentRecord): void {
	try {
		ensureDir();
		writeFileSync(join(REGISTRY_DIR, `${record.id}.json`), JSON.stringify(record, null, 2), "utf-8");
	} catch { /* best-effort */ }
}

function removeRecord(id: string): void {
	try { unlinkSync(join(REGISTRY_DIR, `${id}.json`)); } catch { /* already gone */ }
}

function isPidAlive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

function readAllRecords(): AgentRecord[] {
	ensureDir();
	const now = Date.now();
	const records: AgentRecord[] = [];

	for (const file of readdirSync(REGISTRY_DIR)) {
		if (!file.endsWith(".json")) continue;
		const fullPath = join(REGISTRY_DIR, file);
		try {
			const record: AgentRecord = JSON.parse(readFileSync(fullPath, "utf-8"));
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

function cleanupAgentFiles(id: string): void {
	const sockPath = join(REGISTRY_DIR, `${id}.sock`);
	const maildirPath = join(REGISTRY_DIR, id);
	try { unlinkSync(sockPath); } catch { /* */ }
	try { rmSync(maildirPath, { recursive: true, force: true }); } catch { /* */ }
}

// ── Maildir IO ──────────────────────────────────────────────────

let maildirSeq = 0;

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

function maildirPrune(maildirPath: string, keep: number): void {
	try {
		const files = readdirSync(maildirPath).filter((f) => f.endsWith(".json")).sort();
		if (files.length <= keep) return;
		for (const f of files.slice(0, files.length - keep)) {
			try { unlinkSync(join(maildirPath, f)); } catch { /* */ }
		}
	} catch { /* */ }
}

function maildirRead(maildirPath: string, count: number): MaildirEntry[] {
	try {
		if (!existsSync(maildirPath)) return [];
		const files = readdirSync(maildirPath).filter((f) => f.endsWith(".json")).sort();
		return files.slice(-count).map((f) => {
			try { return JSON.parse(readFileSync(join(maildirPath, f), "utf-8")); } catch { return null; }
		}).filter(Boolean) as MaildirEntry[];
	} catch { return []; }
}

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

// ── Powerline widget ────────────────────────────────────────────

function sortRecords(records: AgentRecord[], selfId: string): AgentRecord[] {
	return [...records].sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return a.startedAt - b.startedAt;
	});
}

function renderPowerlineWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const sorted = sortRecords(records, selfId);

	const segments = sorted.map((rec) => {
		const isSelf = rec.id === selfId;
		const sym = STATUS_SYMBOL[rec.status];
		const name = rec.name;
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

	const separator = theme.fg("dim", ` ${PL_SEP_THIN} `);
	return [truncateToWidth(segments.join(separator), availableWidth)];
}

function refreshWidget(ctx: ExtensionContext, selfId: string): void {
	try {
		const records = readAllRecords();
		if (records.length === 0) {
			ctx.ui.setWidget("agent-panopticon", undefined);
			ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("dim", "agents: 0"));
			return;
		}

		ctx.ui.setWidget("agent-panopticon", (_tui, theme) => ({
			render(width: number): string[] {
				return renderPowerlineWidget(readAllRecords(), selfId, theme, width);
			},
			invalidate(): void { /* fresh data on each render */ },
		}), { placement: "belowEditor" });

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

async function openAgentOverlay(
	ctx: ExtensionCommandContext,
	selfId: string,
): Promise<void> {
	const records = readAllRecords();
	if (records.length === 0) {
		ctx.ui.notify("No agents registered", "info");
		return;
	}

	const sorted = sortRecords(records, selfId);

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
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
		container.addChild(new Text(
			theme.fg("accent", theme.bold(" Agent Panopticon")) +
			theme.fg("dim", ` — ${records.length} agent${records.length !== 1 ? "s" : ""}`),
			1, 0,
		));

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
		container.addChild(new Text(theme.fg("dim", "  ↑↓ navigate • enter view detail • esc close"), 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => { selectList.handleInput(data); tui.requestRender(); },
		};
	});

	if (!selected) return;
	await showAgentDetail(ctx, selfId, selected);
}

async function showAgentDetail(
	ctx: ExtensionCommandContext,
	selfId: string,
	agentName: string,
): Promise<void> {
	const records = readAllRecords();
	const rec = records.find(r => r.name.toLowerCase() === agentName.toLowerCase());
	if (!rec) {
		ctx.ui.notify(`Agent "${agentName}" not found`, "warning");
		return;
	}

	const isSelf = rec.id === selfId;
	const entries = maildirRead(join(REGISTRY_DIR, rec.id), 20);

	await ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		const sym = STATUS_SYMBOL[rec.status];
		const selfTag = isSelf ? theme.fg("dim", " (you)") : "";
		container.addChild(new Text(
			`  ${sym} ${theme.fg("accent", theme.bold(rec.name))}${selfTag}  ${theme.fg("muted", rec.status)}`,
			1, 0,
		));

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

		container.addChild(new Text(
			`\n  ${theme.fg("accent", theme.bold("Recent Activity"))} ${theme.fg("dim", `(${entries.length} events)`)}`,
			1, 0,
		));

		if (entries.length === 0) {
			container.addChild(new Text(`  ${theme.fg("dim", "(no activity recorded)")}`, 1, 0));
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

		const helpParts = ["esc back"];
		if (!isSelf) helpParts.push("m send message");
		container.addChild(new Text(`\n  ${theme.fg("dim", helpParts.join(" • "))}`, 1, 0));
		container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

		return {
			render: (w: number) => container.render(w),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, "escape")) {
					done();
				} else if (!isSelf && (data === "m" || data === "M")) {
					done();
					ctx.ui.setEditorText(`/send ${rec.name} `);
				}
			},
		};
	});
}

// ── Tool result helper ──────────────────────────────────────────

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

	function emit(event: string, data: Record<string, unknown> = {}): void {
		maildirWrite(selfMaildir, { ts: Date.now(), event, ...data });
	}

	// ── Socket server (receives messages from peers) ────────────

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
				conn.on("error", () => { /* */ });
			});

			socketServer.listen(selfSocketPath);
			socketServer.on("error", () => { socketServer = null; });
			socketServer.unref();
		} catch {
			socketServer = null;
		}
	}

	function handleSocketCommand(cmd: SocketCommand, conn: net.Socket): void {
		switch (cmd.type) {
			case "cast": {
				const from = cmd.from ?? "unknown";
				const text = cmd.text ?? "";
				if (!text) {
					conn.end(JSON.stringify({ ok: false, error: "Empty message" }) + "\n");
					return;
				}
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

	// ── /agents overlay ─────────────────────────────────────────

	pi.registerCommand("agents", {
		description: "Open agent panopticon overlay — browse all agents, view details & activity",
		handler: async (_args, ctx) => {
			await openAgentOverlay(ctx, selfId);
		},
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Open agent panopticon overlay",
		handler: async (ctx) => {
			await openAgentOverlay(ctx as unknown as ExtensionCommandContext, selfId);
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
					const taskStr = r.task ? `  "${r.task.slice(0, 50)}"` : "";
					return `  ${STATUS_SYMBOL[r.status]} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${transport.padEnd(12)} ${r.model || "?"} up=${formatAge(r.startedAt)}${self}${taskStr}`;
				});

				return textResult(
					`${records.length} registered agent(s):\n${listing.join("\n")}\n\nUse agent_peek with an agent name to read their activity.\nUse agent_send to message a peer.`,
					{ agents: records.map((r) => ({ name: r.name, pid: r.pid, socket: r.socket, cwd: r.cwd, status: r.status, model: r.model, task: r.task, isSelf: r.id === selfId })) },
				);
			}

			// Resolve target by name
			const lower = params.target.replace(/^@/, "").toLowerCase();
			const records = readAllRecords();
			const peer = records.find((r) => r.name.toLowerCase() === lower && r.id !== selfId);
			if (!peer) {
				const names = records.filter((r) => r.id !== selfId).map((r) => r.name);
				return textResult(
					`No agent named "${params.target}". Known peers: ${names.length ? names.join(", ") : "(none)"}`,
				);
			}

			const lineCount = params.lines ?? 50;
			const maildirPath = join(REGISTRY_DIR, peer.id);
			if (existsSync(maildirPath)) {
				const entries = maildirRead(maildirPath, lineCount);
				const content = formatMaildirEntries(entries);
				return textResult(
					`Agent "${peer.name}" activity (last ${entries.length} events):\n\n${content}`,
					{ target: peer.name, transport: "maildir", events: entries.length },
				);
			}

			return textResult(`Agent "${params.target}" has no activity log yet.`, {});
		},
	});
}
