/**
 * Spawn service — child process lifecycle for pi agents.
 *
 * Tool-API agnostic. Provides the primitives any extension needs to start a
 * pi subprocess and shut it down cleanly. RPC and event-formatting helpers
 * live in spawn-rpc.ts and spawn-events.ts respectively.
 */

import type { ChildProcess } from "node:child_process";
import { execSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ── PI binary resolution ────────────────────────────────────────

/** Locate the pi CLI: bundled with the current node binary, then `which pi`, else literal "pi". */
export function resolvePiBinary(): string {
	const candidate = join(dirname(process.execPath), "pi");
	if (existsSync(candidate)) return candidate;
	try {
		const resolved = execSync("which pi", { encoding: "utf-8" }).trim();
		if (resolved && existsSync(resolved)) return resolved;
	} catch {
		/* not found */
	}
	return "pi";
}

const PI_BINARY = resolvePiBinary();

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

// ── Spawn arg building ──────────────────────────────────────────

export interface ArgParams {
	model?: string;
	tools?: string[];
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
	if (p.tools?.length) {
		const validToolName = /^[a-zA-Z0-9_-]+$/;
		const clean = p.tools.filter((t) => validToolName.test(t));
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
const GRACEFUL_WAIT_MS = 2_000;

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

export interface SpawnOpts {
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

	let buf = "";
	proc.stdout?.on("data", (chunk: Buffer) => {
		buf += chunk.toString();
		const lines = buf.split("\n");
		buf = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.trim()) continue;
			agent.recentEvents.push(line);
			if (agent.recentEvents.length > MAX_RECENT_EVENTS)
				agent.recentEvents.shift();
			agent.emitter.emit("line", line);
		}
	});

	proc.stderr?.on("data", (chunk: Buffer) => {
		agent.recentEvents.push(`[stderr] ${chunk.toString().trim()}`);
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
		agent.recentEvents.push(`[process exited with code ${code}]`);
		agent.emitter.emit("line", JSON.stringify({ type: "process_exit", code }));
		cleanTemp();
	});

	proc.on("error", (err: Error) => {
		agent.done = true;
		agent.recentEvents.push(`[process error: ${err.message}]`);
		agent.emitter.emit(
			"line",
			JSON.stringify({ type: "process_error", message: err.message }),
		);
		cleanTemp();
	});

	proc.unref();
	return agent;
}
