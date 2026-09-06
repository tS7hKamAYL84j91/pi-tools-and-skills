/**
 * Spawn service — child process lifecycle for pi agents.
 *
 * Tool-API agnostic. Provides the primitives any extension needs to start a
 * pi subprocess and shut it down cleanly. RPC and event-formatting helpers
 * live in spawn-rpc.ts and spawn-events.ts respectively.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── PI binary resolution ────────────────────────────────────────

/** Locate the pi CLI: bundled with the current node binary, then check safe path directories, else literal "pi". */
function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) return candidate;

	const allowedDirs = [
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/opt/homebrew/bin",
		join(homedir(), ".local", "bin")
	];

	for (const dir of allowedDirs) {
		const resolved = join(dir, "pi");
		if (existsSync(resolved)) return resolved;
	}

	return "pi";
}

const PI_BINARY = resolvePiBinary();

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ── Spawn arg building ──────────────────────────────────────────

interface ArgParams {
	model?: string;
	tools?: string[] | null;
	sessionDir?: string;
	name: string;
}

function defaultSubagentSessionDir(name: string): string {
	return join(homedir(), ".pi", "agent", "sessions", "subagents", name);
}

/**
 * Build the CLI arg list for spawning a pi agent (pure — no side effects).
 * System-prompt file creation is handled separately by the caller.
 */
export function buildArgList(p: ArgParams): string[] {
	const args = ["--mode", "rpc"];
	if (p.model) args.push("--models", p.model);
	const tools = Array.isArray(p.tools) ? p.tools : [];
	if (tools.length > 0) {
		const validToolName = /^[a-zA-Z0-9_-]+$/;
		const clean = tools.filter((t) => validToolName.test(t));
		if (clean.length > 0) args.push("--tools", clean.join(","));
	}
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
const MAX_RECENT_BYTES = 1024 * 1024;
const MAX_STDERR_CHUNK_BYTES = 64 * 1024;
const MAX_RPC_FRAME_BYTES = 8 * 1024 * 1024;
const GRACEFUL_WAIT_MS = 2_000;

/** Bound diagnostic history without truncating frames delivered to RPC listeners. */
export function retainSpawnEvent(agent: SpawnedAgent, event: string): void {
	const retained = Buffer.byteLength(event) > MAX_RECENT_BYTES ? "[output omitted: event exceeds 1 MiB history limit]" : event;
	agent.recentEvents.push(retained);
	let bytes = agent.recentEvents.reduce((total, line) => total + Buffer.byteLength(line), 0);
	while (agent.recentEvents.length > MAX_RECENT_EVENTS || bytes > MAX_RECENT_BYTES) {
		bytes -= Buffer.byteLength(agent.recentEvents.shift() ?? "");
	}
}

// ── Graceful shutdown ─────────────────────────────────────────────

/** Graceful shutdown: abort → wait → SIGTERM → wait → SIGKILL. */
export async function gracefulKill(
	agent: SpawnedAgent,
	writeAbort: (a: SpawnedAgent) => void,
): Promise<void> {
	writeAbort(agent);
	const closed = new Promise<void>((res) => agent.proc.once("close", res));
	await Promise.race([closed, sleep(GRACEFUL_WAIT_MS)]);
	if (!agent.done) {
		try {
			agent.proc.kill("SIGTERM");
		} catch {
			/* already exited */
		}
		await Promise.race([closed, sleep(GRACEFUL_WAIT_MS)]);
		if (!agent.done)
			try {
				agent.proc.kill("SIGKILL");
			} catch {
				/* already exited */
			}
	}
}

// ── Child process spawning ──────────────────────────────────────

interface SpawnOpts {
	name: string;
	cwd: string;
	args: string[];
	model?: string;
	tempDir?: string;
	env?: NodeJS.ProcessEnv;
}

/** Spawn a pi child process, wire stdout/stderr to the agent's event stream. */
export function spawnChild(opts: SpawnOpts): SpawnedAgent {
	const { name, cwd: agentCwd, args, model, tempDir, env } = opts;
	const proc = spawn(PI_BINARY, args, {
		cwd: agentCwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: env ?? process.env,
	});

	const agent: SpawnedAgent = {
		name,
		proc,
		pid: proc.pid ?? 0,
		cwd: agentCwd,
		model,
		startedAt: Date.now(),
		recentEvents: [],
		emitter: new EventEmitter(),
		tempDir,
		done: !proc.pid,
	};

	let buf: Buffer = Buffer.alloc(0);
	proc.stdout?.on("data", (chunk: Buffer) => {
		if (agent.done) return;
		let offset = 0;
		while (offset < chunk.length) {
			const newline = chunk.indexOf(10, offset);
			const end = newline < 0 ? chunk.length : newline;
			if (buf.length + end - offset > MAX_RPC_FRAME_BYTES) {
				buf = Buffer.alloc(0);
				agent.done = true;
				const message = "Child RPC frame exceeds 8 MiB limit; child terminated";
				retainSpawnEvent(agent, `[process error: ${message}]`);
				try { proc.kill("SIGKILL"); } catch { /* already exited */ }
				agent.emitter.emit("line", JSON.stringify({ type: "process_error", message }));
				return;
			}
			buf = Buffer.concat([buf, chunk.subarray(offset, end)]);
			if (newline < 0) return;
			// Decode only complete frames so split UTF-8 characters remain intact.
			const line = buf.toString("utf8");
			buf = Buffer.alloc(0);
			offset = newline + 1;
			if (!line.trim()) continue;
			retainSpawnEvent(agent, line);
			agent.emitter.emit("line", line);
		}
	});

	proc.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.subarray(0, MAX_STDERR_CHUNK_BYTES).toString().trim();
		retainSpawnEvent(agent, `[stderr] ${text}${chunk.length > MAX_STDERR_CHUNK_BYTES ? " [truncated]" : ""}`);
	});

	const cleanTemp = () => {
		if (tempDir)
			try {
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
	};

	proc.on("close", (code: number | null) => {
		agent.done = true;
		buf = Buffer.alloc(0);
		retainSpawnEvent(agent, `[process exited with code ${code}]`);
		agent.emitter.emit("line", JSON.stringify({ type: "process_exit", code }));
		cleanTemp();
	});

	proc.on("error", (err: Error) => {
		agent.done = true;
		buf = Buffer.alloc(0);
		retainSpawnEvent(agent, `[process error: ${err.message}]`);
		agent.emitter.emit(
			"line",
			JSON.stringify({ type: "process_error", message: err.message }),
		);
		cleanTemp();
	});

	proc.unref();
	return agent;
}
