/**
 * Pi Panopticon — Agent Registry & Monitoring
 *
 * Central observation point for all running pi agents.
 * Every pi instance registers itself on startup and heartbeats its status.
 *
 * Responsibilities (monitoring ONLY):
 * - Agent registry: ~/.pi/agents/{id}.json
 * - Heartbeat & status tracking
 * - Unix socket server for receiving messages
 * - agent_peek tool (reads pi session JSONL, transport-agnostic)
 * - Powerline compact widget
 * - /agents overlay + /alias command
 *
 * Does NOT provide: messaging (see pi-messaging.ts), spawning (see pi-subagent.ts)
 */

import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Container, Text, type SelectItem, SelectList, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import {
	existsSync,
	readFileSync,
	readdirSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import * as net from "node:net";
import { basename, join } from "node:path";
import { ok } from "../lib/tool-result.js";
import { readSessionLog, formatSessionLog } from "../lib/session-log.js";
import {
	type AgentRecord,
	type AgentStatus,
	REGISTRY_DIR,
	STALE_MS,
	isPidAlive,
	ensureRegistryDir,
} from "../lib/agent-registry.js";

// ── Constants ───────────────────────────────────────────────────

const HEARTBEAT_MS = 5_000;

// Panopticon socket wire protocol — local to this extension
interface SocketCommand {
	type: "cast" | "call" | "peek";
	from?: string;
	text?: string;
	lines?: number;
}

const SOCKET_TIMEOUT_MS = 3_000;
const STATUS_SYMBOL: Record<AgentStatus, string> = {
	running: "🟢", waiting: "🟡", done: "✅",
	blocked: "🚧", stalled: "🛑", terminated: "⚫", unknown: "⚪",
};

const PL_SEP      = "\uE0B0"; // ❯ filled right-pointing triangle
const PL_SEP_THIN = "\uE0B1"; // ❯ thin right-pointing triangle

// ── Pure functions ──────────────────────────────────────────────

export function classifyRecord(record: AgentRecord, now: number, pidAlive: boolean): "live" | "stalled" | "dead" {
	if (now - record.heartbeat <= STALE_MS) return "live";
	return pidAlive ? "stalled" : "dead";
}

/** @internal exported for tests */ export function buildRecord(base: AgentRecord, status: AgentStatus, task: string | undefined, reportExists = false): AgentRecord {
	const refined = (status === "waiting" && reportExists) ? "done" : status;
	return { ...base, heartbeat: Date.now(), status: refined, task };
}

export function formatAge(startedAt: number): string {
	const secs = Math.round((Date.now() - startedAt) / 1000);
	return secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
}

export function nameTaken(name: string, records: AgentRecord[], selfId: string): boolean {
	const lower = name.toLowerCase();
	return records.some((r) => r.name.toLowerCase() === lower && r.id !== selfId);
}

export function pickName(cwd: string, records: AgentRecord[], selfId: string): string {
	const base = basename(cwd) || "agent";
	if (!nameTaken(base, records, selfId)) return base;
	for (let i = 2; i < 100; i++) {
		const candidate = `${base}-${i}`;
		if (!nameTaken(candidate, records, selfId)) return candidate;
	}
	return `${base}-${selfId.slice(0, 6)}`;
}

// ── Registry IO ─────────────────────────────────────────────────

function writeRecord(record: AgentRecord): void {
	try {
		ensureRegistryDir();
		writeFileSync(join(REGISTRY_DIR, `${record.id}.json`), JSON.stringify(record, null, 2), "utf-8");
	} catch { /* best-effort */ }
}

function removeRecord(id: string): void {
	try { unlinkSync(join(REGISTRY_DIR, `${id}.json`)); } catch { /* already gone */ }
}

function readAllRecords(): AgentRecord[] {
	ensureRegistryDir();
	const now = Date.now();
	return (readdirSync(REGISTRY_DIR) as string[]).filter((f) => typeof f === "string" && f.endsWith(".json")).flatMap((file) => {
		const fullPath = join(REGISTRY_DIR, file);
		try {
			const record: AgentRecord = JSON.parse(readFileSync(fullPath, "utf-8"));
			if (!record.name) record.name = basename(record.cwd) || record.id.slice(0, 8);
			const cls = classifyRecord(record, now, isPidAlive(record.pid));
			if (cls === "dead") { unlinkSync(fullPath); cleanupAgentFiles(record.id); return []; }
			if (cls === "stalled") record.status = "stalled";
			return [record];
		} catch { try { unlinkSync(fullPath); } catch { /* */ } return []; }
	});
}

/** @internal exported for tests */
export function agentCleanupPaths(id: string): string[] {
	return [
		join(REGISTRY_DIR, `${id}.json`),
		join(REGISTRY_DIR, `${id}.sock`),
	];
}

function cleanupAgentFiles(id: string): void {
	try { unlinkSync(join(REGISTRY_DIR, `${id}.sock`)); } catch { /* */ }
	// NOTE: Do NOT delete REGISTRY_DIR/{id}/ — that’s messaging infrastructure
	// owned by the transport. Panopticon only cleans its own artifacts.
}

// ── Powerline widget ────────────────────────────────────────────

export function sortRecords(records: AgentRecord[], selfId: string): AgentRecord[] {
	return [...records].sort((a, b) => {
		if (a.id === selfId) return -1;
		if (b.id === selfId) return 1;
		return a.startedAt - b.startedAt;
	});
}

/** Map status → short label shown after the colon in powerline segments. */
const STATUS_LABEL: Record<AgentStatus, string> = {
	running: "active", waiting: "idle", done: "done",
	blocked: "blocked", stalled: "stalled", terminated: "dead", unknown: "?",
};

type ThemeColor = Parameters<ExtensionContext["ui"]["theme"]["fg"]>[0];

/** Map status → theme colour key for the name portion of a segment. */
const STATUS_COLOR: Record<AgentStatus, ThemeColor> = {
	running: "success", waiting: "accent", done: "dim",
	blocked: "warning", stalled: "warning", terminated: "error", unknown: "muted",
};

/** Build Powerline segments for all agents; self is bold accent, peers use STATUS_COLOR. */
function buildPowerlineSegments(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
): string[] {
	return sortRecords(records, selfId).map((rec) => {
		const sym = STATUS_SYMBOL[rec.status];
		const label = STATUS_LABEL[rec.status];
		const inbox = (rec.pendingMessages ?? 0) > 0 ? theme.fg("warning", `(✉${rec.pendingMessages})`) : "";
		if (rec.id === selfId)
			return `${sym} ${theme.fg("accent", theme.bold(rec.name))}${theme.fg("dim", `:${label}`)}${inbox}`;
		const offline = rec.socket ? "" : theme.fg("error", "○");
		return `${sym} ${offline}${theme.fg(STATUS_COLOR[rec.status], rec.name)}${theme.fg("dim", `:${label}`)}${inbox}`;
	});
}

function renderPowerlineWidget(
	records: AgentRecord[],
	selfId: string,
	theme: ExtensionContext["ui"]["theme"],
	availableWidth: number,
): string[] {
	const segs = buildPowerlineSegments(records, selfId, theme);
	const separator = theme.fg("dim", ` ${PL_SEP_THIN} `);
	return [truncateToWidth(segs.join(separator), availableWidth)];
}

function refreshWidget(ctx: ExtensionContext, selfId: string): void {
	try {
		const records = readAllRecords();
		if (records.length === 0) {
			ctx.ui.setWidget("agent-panopticon", undefined);
			ctx.ui.setStatus("agent-panopticon", ctx.ui.theme.fg("dim", "agents: 0"));
			return;
		}

		ctx.ui.setWidget("agent-panopticon", (_tui: unknown, theme: ExtensionContext["ui"]["theme"]) => ({
			render(width: number): string[] {
				return renderPowerlineWidget(readAllRecords(), selfId, theme, width);
			},
			invalidate(): void { /* fresh data on each render */ },
		}), { placement: "belowEditor" });

		const peers = records.filter(r => r.id !== selfId);
		const running = peers.filter(r => r.status === "running").length;
		const waiting = peers.filter(r => r.status === "waiting").length;
		const label = peers.length === 0 ? "solo"
			: (running > 0 || waiting > 0)
				? [[running, "▶"], [waiting, "⏸"]].filter(([n]) => n).map(([n, s]) => `${n}${s}`).join(" ")
				: `${peers.length} peer${peers.length !== 1 ? "s" : ""}`;
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

	const items: SelectItem[] = sorted.map((rec) => ({
		value: rec.name,
		label: `${STATUS_SYMBOL[rec.status]} ${rec.name}${rec.id === selfId ? " (you)" : ""}`,
		description: `${rec.status} │ ${rec.socket ? "⚡socket" : "no-transport"} │ ${rec.model || "?"} │ up ${formatAge(rec.startedAt)}`
			+ (rec.task ? ` │ ${rec.task.slice(0, 50)}` : ""),
	}));

	const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const container = new Container();
		container.addChild(border());
		container.addChild(new Text(
			theme.fg("accent", theme.bold(" Agent Panopticon")) +
			theme.fg("dim", ` — ${records.length} agent${records.length !== 1 ? "s" : ""}`),
			1, 0,
		));
		container.addChild(new Text(
			` ${buildPowerlineSegments(sorted, selfId, theme).join(theme.fg("dim", ` ${PL_SEP} `))}`,
			1, 1,
		));
		container.addChild(new Text(theme.fg("dim", " ─────────────────────────────────────────────────────"), 1, 0));
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
		container.addChild(border());

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
	const sessionEvents = rec.sessionFile ? readSessionLog(rec.sessionFile, 20) : [];

	await ctx.ui.custom<void>((_tui, theme, _kb, done) => {
		const border = () => new DynamicBorder((s: string) => theme.fg("accent", s));
		const add = (s: string) => container.addChild(new Text(s, 1, 0));
		const row = (label: string, value: string) =>
			add(`  ${theme.fg("dim", label.padEnd(12))} ${theme.fg("text", value)}`);
		const container = new Container();
		container.addChild(border());
		add(`  ${STATUS_SYMBOL[rec.status]} ${theme.fg("accent", theme.bold(rec.name))}${isSelf ? theme.fg("dim", " (you)") : ""}  ${theme.fg("muted", rec.status)}`);
		const pending = rec.pendingMessages ?? 0;
		const details: [string, string][] = [
			["Model",     rec.model || "unknown"],
			["CWD",       rec.cwd],
			["PID",       String(rec.pid)],
			["Transport", rec.socket ? "⚡ Unix socket" : "none"],
			["Messages",  `pending: ${pending}`],
			["Uptime",    formatAge(rec.startedAt)],
			["REPORT.md", existsSync(join(rec.cwd, "REPORT.md")) ? "☑ exists" : "—"],
		];
		if (rec.task) details.push(["Task", rec.task.slice(0, 60)]);
		for (const [label, value] of details) row(label, value);
		add(`\n  ${theme.fg("accent", theme.bold("Recent Activity"))} ${theme.fg("dim", `(${sessionEvents.length} events)`)}`);
		if (sessionEvents.length === 0) {
			add(`  ${theme.fg("dim", "(no activity recorded)")}`);
		} else {
			for (const entry of sessionEvents.slice(-15)) {
				const ts = new Date(entry.ts).toISOString().slice(11, 19);
				const event = String(entry.event ?? "?");
				const col: ThemeColor = event.includes("error") ? "error"
					: event.includes("start") ? "success"
					: event.includes("end") ? "warning" : "dim";
				const extra = Object.entries(entry).filter(([k]) => k !== "ts" && k !== "event").map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(" ");
				add(`  ${theme.fg("dim", ts)} ${theme.fg(col, event)}${extra ? theme.fg("muted", ` ${extra}`) : ""}`);
			}
		}
		add(`\n  ${theme.fg("dim", ["esc back", ...(!isSelf ? ["m send message"] : [])].join(" • "))}`);
		container.addChild(border());

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



// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const selfId = `${process.pid}-${Date.now().toString(36)}`;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let widgetTimer: ReturnType<typeof setInterval> | null = null;
	let status: AgentStatus = "waiting";
	let task: string | undefined;
	let record: AgentRecord | undefined;

	const selfSocketPath = join(REGISTRY_DIR, `${selfId}.sock`);
	let socketServer: net.Server | null = null;

	function heartbeat(): void {
		if (!record) return;
		if (!socketServer) startSocket(); // rebind after sleep/wake
		const hasReport = status === "waiting" && (() => { try { return existsSync(join(record.cwd, "REPORT.md")); } catch { return false; } })();
		record = {
			...buildRecord(record, status, task, hasReport),
			socket: socketServer ? selfSocketPath : undefined,
		};
		writeRecord(record);
	}

	function clearTimers(): void {
		if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
		if (widgetTimer) { clearInterval(widgetTimer); widgetTimer = null; }
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
							conn.end(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
						}
					}
				});
				conn.on("timeout", () => conn.destroy());
				conn.on("error", () => { /* */ });
			});

			socketServer.listen(selfSocketPath);
			socketServer.on("error", () => {
				socketServer = null;
				// Remove stale socket file so retries can rebind
				try { unlinkSync(selfSocketPath); } catch { /* */ }
			});
			socketServer.unref();
		} catch {
			socketServer = null;
		}
	}

	function handleSocketCommand(cmd: SocketCommand, conn: net.Socket): void {
		const reply = (payload: object) => conn.end(`${JSON.stringify(payload)}\n`);
		switch (cmd.type) {
			case "cast": {
				const from = cmd.from ?? "unknown";
				const text = cmd.text ?? "";
				if (!text) { reply({ ok: false, error: "Empty message" }); return; }
				try {
					pi.sendUserMessage(`[from ${from}]: ${text}`, { deliverAs: "followUp" });
					reply({ ok: true });
				} catch (err) {
					reply({ ok: false, error: String(err) });
				}
				break;
			}
			case "peek": {
				const events = record?.sessionFile ? readSessionLog(record.sessionFile, cmd.lines ?? 50) : [];
				reply({ ok: true, events });
				break;
			}
			default:
				reply({ ok: false, error: `Unknown command: ${cmd.type}` });
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
		const cwd = process.cwd();
		try {
			const brief = existsSync(join(cwd, "BRIEF.md")) ? readFileSync(join(cwd, "BRIEF.md"), "utf-8") : "";
			const line = brief.split("\n").find((l) => l.trim() && !l.startsWith("#"));
			if (line) task = line.trim();
		} catch { /* */ }

		startSocket();

		const records = readAllRecords();
		record = {
			id: selfId,
			name: pickName(cwd, records, selfId),
			pid: process.pid,
			cwd,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			socket: socketServer ? selfSocketPath : undefined,
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting",
			task,
			sessionDir: ctx.sessionManager.getSessionDir(),
			sessionFile: ctx.sessionManager.getSessionFile(),
		};
		writeRecord(record);
		heartbeatTimer = setInterval(() => heartbeat(), HEARTBEAT_MS);
		if (ctx.hasUI) {
			refreshWidget(ctx, selfId);
			widgetTimer = setInterval(() => refreshWidget(ctx, selfId), HEARTBEAT_MS);
		}
	});

	pi.on("agent_start", async () => {
		status = "running";
		heartbeat();
	});

	pi.on("agent_end", async () => {
		status = "waiting";
		heartbeat();
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
		description: "Show compact Powerline status bar for all agents, then open detail overlay",
		handler: async (_args, ctx) => {
			// Always flash the compact status line as a quick scannable summary
			const records = readAllRecords();
			if (records.length === 0) {
				ctx.ui.notify("No agents registered", "info");
				return;
			}
			ctx.ui.notify(
				sortRecords(records, selfId)
					.map((r) => `${STATUS_SYMBOL[r.status]} ${r.name}:${STATUS_LABEL[r.status]}`)
					.join(` ${PL_SEP_THIN} `),
				"info",
			);
			// Then open full interactive overlay for details
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
			const records = readAllRecords();
			if (!params.target) {
				if (records.length === 0) return ok("No agents registered.", { agents: [] });
				const listing = records.map((r) =>
					`  ${STATUS_SYMBOL[r.status]} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${
						(r.socket ? "⚡socket" : "no-socket").padEnd(12)} ${r.model || "?"} up=${formatAge(r.startedAt)}${
						(r.pendingMessages ?? 0) > 0 ? ` ✉${r.pendingMessages}` : ""}${
						r.id === selfId ? " (you)" : ""}${r.task ? `  "${r.task.slice(0, 50)}"` : ""}`,
				);
				return ok(
					`${records.length} registered agent(s):\n${listing.join("\n")}\n\nUse agent_peek with an agent name to read their activity.\nUse agent_send or agent_send_durable to message a peer.`,
					{ agents: records.map((r) => ({ name: r.name, pid: r.pid, socket: r.socket, cwd: r.cwd, status: r.status, model: r.model, task: r.task, isSelf: r.id === selfId, pendingMessages: r.pendingMessages })) },
				);
			}

			// Resolve target by name
			const lower = params.target.replace(/^@/, "").toLowerCase();
			const peer = records.find((r) => r.name.toLowerCase() === lower && r.id !== selfId);
			if (!peer) {
				const names = records.filter((r) => r.id !== selfId).map((r) => r.name);
				return ok(`No agent named "${params.target}". Known peers: ${names.length ? names.join(", ") : "(none)"}`);
			}
			// Use session JSONL instead of maildir (Phase 3)
			if (!peer.sessionFile) {
				return ok(`Agent "${params.target}" has no session log yet.`, { target: peer.name, hasSessionFile: false });
			}
			const sessionEvents = readSessionLog(peer.sessionFile, params.lines ?? 50);
			return ok(
				`Agent "${peer.name}" activity (last ${sessionEvents.length} events):\n\n${formatSessionLog(sessionEvents)}`,
				{ target: peer.name, transport: "session", events: sessionEvents.length },
			);
		},
	});
}
