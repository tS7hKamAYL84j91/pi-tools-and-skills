/**
 * Spawner utilities — Pure helpers for agent spawning.
 *
 * Event formatting, CLI arg building, and PI binary resolution.
 * No side effects, no state — used by spawner.ts.
 */

import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── PI binary ───────────────────────────────────────────────────

function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) return candidate;
	try {
		const resolved = execSync("which pi", { encoding: "utf-8" }).trim();
		if (resolved && existsSync(resolved)) return resolved;
	} catch { /* not found */ }
	return "pi";
}

const PI_BINARY = resolvePiBinary();

// ── Utilities ───────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ── Event formatting ────────────────────────────────────────────

type Evt = Record<string, unknown>;

const EVENT_FORMATTERS: Record<string, (e: Evt) => string> = {
	message_update: (e) => {
		const d = e.assistantMessageEvent as Evt | undefined;
		return d?.type === "text_delta" ? String(d.delta) : "";
	},
	tool_execution_start: (e) =>
		`\n⚙ ${e.toolName}(${JSON.stringify(e.args ?? {}).slice(0, 80)})`,
	tool_execution_end: (e) => {
		const text = (e.result as Evt | undefined)?.content;
		const first = Array.isArray(text) ? (text[0] as Evt | undefined)?.text : undefined;
		return `  → ${String(first ?? "(done)").slice(0, 100)}`;
	},
	agent_start: () => "\n▶ agent started",
	agent_end: () => "\n■ agent finished",
	response: (e) => `  [${e.command}: ${e.success ? "ok" : e.error}]`,
};

/** Format a single JSONL event line into a compact human-readable string. */
export function formatEvent(line: string): string {
	try {
		const evt = JSON.parse(line) as Evt;
		const fmt = EVENT_FORMATTERS[String(evt.type ?? "?")];
		return fmt ? fmt(evt) : `  [${evt.type ?? "?"}]`;
	} catch {
		return line.slice(0, 120);
	}
}

/** Format the last `lines` events from an array into readable output. */
export function recentOutputFromEvents(events: string[], lines = 20): string {
	if (events.length === 0) return "(no events yet)";
	return events
		.slice(-lines)
		.map(formatEvent)
		.filter(Boolean)
		.join("");
}

// ── Spawn arg building ──────────────────────────────────────────

interface ArgParams {
	model?: string;
	tools?: string[];
	sessionDir?: string;
	name: string;
}

/** Default session directory for subagents. */
function defaultSubagentSessionDir(name: string): string {
	return join(homedir(), ".pi", "agent", "sessions", "subagents", name);
}

/**
 * Build the CLI arg list for spawning a pi agent (pure — no side effects).
 * System-prompt file creation is handled separately in spawn_agent.
 */
export function buildArgList(p: ArgParams): string[] {
	const args = ["--mode", "rpc"];
	if (p.model) args.push("--models", p.model);
	if (p.tools?.length) args.push("--tools", p.tools.join(","));
	const sessionDir = p.sessionDir ?? defaultSubagentSessionDir(p.name);
	args.push("--session-dir", sessionDir);
	return args;
}

// ── Types ───────────────────────────────────────────────────────

export interface SpawnedAgent {
	name: string;
	proc: ChildProcess;
	pid: number;
	cwd: string;
	model?: string;
	startedAt: number;
	recentEvents: string[];
	emitter: EventEmitter;
	tempDir?: string;
	done: boolean;
}

const MAX_RECENT_EVENTS = 100;
const GRACEFUL_WAIT_MS = 2_000;

// ── Graceful shutdown ─────────────────────────────────────────────

/**
 * Graceful shutdown: abort → wait → SIGTERM → wait → SIGKILL.
 * Shared by kill_agent and shutdownAll.
 */
export async function gracefulKill(
	agent: SpawnedAgent,
	writeAbort: (a: SpawnedAgent) => void,
): Promise<void> {
	writeAbort(agent);
	const closed = new Promise<void>((res) => agent.proc.once("close", res));
	await Promise.race([closed, sleep(GRACEFUL_WAIT_MS)]);
	if (!agent.done) {
		try { agent.proc.kill("SIGTERM"); } catch { /* */ }
		await Promise.race([closed, sleep(GRACEFUL_WAIT_MS)]);
		if (!agent.done) try { agent.proc.kill("SIGKILL"); } catch { /* */ }
	}
}

// ── Child process spawning ──────────────────────────────────────

interface SpawnOpts {
	name: string;
	cwd: string;
	args: string[];
	model?: string;
	tempDir?: string;
}

/** Spawn a pi child process, wire stdout/stderr to the agent's event stream. */
export function spawnChild(opts: SpawnOpts): SpawnedAgent {
	const { name, cwd: agentCwd, args, model, tempDir } = opts;
	const proc = spawn(PI_BINARY, args, {
		cwd: agentCwd,
		stdio: ["pipe", "pipe", "pipe"],
	});

	const agent: SpawnedAgent = {
		name, proc, pid: proc.pid ?? 0, cwd: agentCwd,
		model, startedAt: Date.now(),
		recentEvents: [], emitter: new EventEmitter(), tempDir, done: !proc.pid,
	};

	let buf = "";
	proc.stdout?.on("data", (chunk: Buffer) => {
		buf += chunk.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			agent.recentEvents.push(line);
			if (agent.recentEvents.length > MAX_RECENT_EVENTS) agent.recentEvents.shift();
			agent.emitter.emit("line", line);
		}
	});

	proc.stderr?.on("data", (chunk: Buffer) => {
		agent.recentEvents.push(`[stderr] ${chunk.toString().trim()}`);
	});

	const cleanTemp = () => {
		if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort */ }
	};

	proc.on("close", (code: number | null) => {
		agent.done = true;
		agent.recentEvents.push(`[process exited with code ${code}]`);
		agent.emitter.emit("line", JSON.stringify({ type: "process_exit", code }));
		cleanTemp();
	});

	proc.on("error", (err: Error) => {
		agent.done = true;
		agent.recentEvents.push(`[process error: ${err.message}]`);
		agent.emitter.emit("line", JSON.stringify({ type: "process_error", message: err.message }));
		cleanTemp();
	});

	proc.unref();
	return agent;
}
