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
 * Transport: tmux (but architecture supports SSH, HTTP, etc.)
 * - /alias <name>     — set your agent name (must be unique)
 * - /agents           — list all registered agents
 * - /send <name> msg  — send a message to a peer
 * - agent_peek        — observe agent registry and pane output
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
	unlinkSync,
	writeFileSync,
} from "node:fs";
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
	startedAt: number;
	heartbeat: number;
	status: AgentStatus;
	task?: string;
}

// ── Constants ───────────────────────────────────────────────────

const REGISTRY_DIR = join(homedir(), ".pi", "agents");
const HEARTBEAT_MS = 5_000;
const STALE_MS = 30_000;

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

/** Read all records, evicting dead entries. Returns live + stalled records. */
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
				// Check children and grandchildren (shell → node → pi)
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

/** Resolve a target string to a tmux address. Accepts name or session:window.pane. */
function resolveTarget(
	raw: string,
	selfId: string,
): { tmux: string; name?: string } {
	if (/^[\w-]+:\d+\.\d+$/.test(raw)) return { tmux: raw };

	const peer = resolveByName(raw, selfId);
	if (!peer) {
		throw new Error(
			`No agent named "${raw}". Known peers: ${peerNames(readAllRecords(), selfId)}`,
		);
	}
	if (!peer.tmux) {
		throw new Error(`Agent "${raw}" is registered but has no tmux pane.`);
	}
	return { tmux: peer.tmux, name: peer.name };
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
		const pane = rec.tmux ? theme.fg("dim", ` ${rec.tmux}`) : "";
		const task = rec.task ? theme.fg("dim", ` ${rec.task.slice(0, 40)}`) : "";
		return `${marker} ${sym} ${theme.fg("success", rec.name)}${pane}${done}${task}`;
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

	function heartbeat(): void {
		if (!record) return;
		record = buildRecord(record, status, task);
		writeRecord(record);
	}

	function clearTimers(): void {
		if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
		if (widgetTimer) { clearInterval(widgetTimer); widgetTimer = null; }
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

		record = {
			id: selfId,
			name: pickName(process.cwd(), records, selfId),
			pid: process.pid,
			cwd: process.cwd(),
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "",
			tmux,
			startedAt: Date.now(),
			heartbeat: Date.now(),
			status: "waiting",
			task,
		};

		writeRecord(record);
		heartbeatTimer = setInterval(() => heartbeat(), HEARTBEAT_MS);

		if (ctx.hasUI) {
			refreshWidget(ctx, selfId);
			widgetTimer = setInterval(() => refreshWidget(ctx, selfId), HEARTBEAT_MS);
		}
	});

	pi.on("agent_start", async () => { status = "running"; heartbeat(); });
	pi.on("agent_end", async () => { status = "waiting"; heartbeat(); });

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
		removeRecord(selfId);
	});

	// ── /name command ───────────────────────────────────────────

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
				const { tmux } = resolveTarget(match[1], selfId);
				await sendToPane(tmux, match[2]);
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
			"List agents discovered in the shared registry, or read the visible output of a specific agent's tmux pane. " +
			"With no target: returns all registered agents and their status. " +
			"With a target (agent name or session:window.pane): captures the pane content.",
		promptSnippet: "Discover agents in tmux or read a specific agent pane's visible output",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({ description: "Agent name or tmux pane address (session:window.pane). Omit to list all agents." }),
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
					const pane = r.tmux ?? "no-tmux";
					const self = r.id === selfId ? " (you)" : "";
					const done = existsSync(join(r.cwd, "REPORT.md")) ? " ☑ done" : "";
					const taskStr = r.task ? `  "${r.task.slice(0, 50)}"` : "";
					return `  ${STATUS_SYMBOL[r.status]} ${r.name.padEnd(20)} ${r.status.padEnd(10)} ${pane.padEnd(10)} ${r.model || "?"} up=${formatAge(r.startedAt)}${self}${done}${taskStr}`;
				});

				return textResult(
					`${records.length} registered agent(s):\n${listing.join("\n")}\n\nUse agent_peek with an agent name to read their pane output.\nUse agent_send to message a peer.`,
					{ agents: records.map((r) => ({ name: r.name, pid: r.pid, tmux: r.tmux, cwd: r.cwd, status: r.status, model: r.model, task: r.task, isSelf: r.id === selfId })) },
				);
			}

			const { tmux } = resolveTarget(params.target.replace(/^@/, ""), selfId);
			const lineCount = params.lines ?? 50;
			const { stdout } = await execAsync(`tmux capture-pane -t ${tmux} -p -S -${lineCount} 2>/dev/null`);
			const content = stdout.trimEnd();

			if (!content) return textResult(`Pane ${tmux} is empty or not found.`, { target: tmux, lines: 0 });
			return textResult(`Pane ${tmux} (last ${lineCount} lines):\n\n${content}`, { target: tmux, lines: content.split("\n").length });
		},
	});

	// ── agent_send tool ─────────────────────────────────────────

	pi.registerTool({
		name: "agent_send",
		label: "Agent Send",
		description:
			"Send a message to a named peer agent. Resolves the name from the registry " +
			"and types the message into their tmux pane. " +
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
			const { tmux } = resolveTarget(params.name, selfId);
			await sendToPane(tmux, params.message);
			const preview = params.message.slice(0, 200) + (params.message.length > 200 ? "…" : "");
			return textResult(
				`Sent to ${params.name} (${tmux}): ${preview}\n\nUse agent_peek "${params.name}" to read the response.`,
				{ name: params.name, tmux, messageLength: params.message.length },
			);
		},
	});
}
