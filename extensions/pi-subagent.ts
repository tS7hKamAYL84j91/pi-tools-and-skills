/**
 * spawn-agent — Agent spawner with RPC + IPC
 *
 * Spawns pi agents in --mode rpc, giving us:
 * 1. Bidirectional stdin/stdout JSON protocol (prompt, steer, abort, get_state)
 * 2. Global extensions inherited (panopticon → socket IPC from any agent)
 * 3. Agent stays alive — send multiple tasks without respawning
 * 4. Two communication channels:
 *    - RPC stdin  (from parent, structured commands)
 *    - Unix socket (from any peer, via agent_send)
 *
 * Tools:
 *   spawn_agent  — launch a new agent
 *   rpc_send     — send an RPC command to a spawned agent's stdin
 *   list_spawned — show all agents spawned by this session
 *   kill_agent   — stop a spawned agent
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
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

import { type ToolResult, ok, fail } from "../lib/tool-result.js";

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
export function defaultSubagentSessionDir(name: string): string {
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
	// Always use a session dir — subagents need JSONL for agent_peek
	const sessionDir = p.sessionDir ?? defaultSubagentSessionDir(p.name);
	args.push("--session-dir", sessionDir);
	return args;
}

// ── Types ───────────────────────────────────────────────────────

interface SpawnedAgent {
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

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const agents = new Map<string, SpawnedAgent>();

	/** Write a JSON command to an agent's stdin. Returns false on failure. */
	function rpcWrite(agent: SpawnedAgent, cmd: Record<string, unknown>): boolean {
		if (agent.done || !agent.proc.stdin?.writable) return false;
		try {
			agent.proc.stdin.write(`${JSON.stringify(cmd)}\n`, (err) => {
				if (err) {
					agent.done = true;
					agent.recentEvents.push(`[stdin write error: ${err.message}]`);
				}
			});
			return true;
		} catch (err) {
			agent.done = true;
			agent.recentEvents.push(`[stdin write error: ${err}]`);
			return false;
		}
	}

	/**
	 * Send an RPC command and resolve when a matching "response" event arrives
	 * (or "agent_end" when waitForAgent=true). Uses the agent's EventEmitter
	 * rather than polling.
	 */
	function rpcCall(
		agent: SpawnedAgent,
		cmd: Record<string, unknown>,
		opts: { waitForAgent?: boolean; timeoutMs?: number } = {},
	): Promise<{ response: Record<string, unknown> | null; events: string[] }> {
		const { waitForAgent = false, timeoutMs = 30_000 } = opts;
		return new Promise((resolve) => {
			const eventsBefore = agent.recentEvents.length;
			if (!rpcWrite(agent, cmd)) {
				resolve({ response: null, events: [] });
				return;
			}

			let response: Record<string, unknown> | null = null;
			let finished = false;

			const finish = () => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				agent.emitter.off("line", onLine);
				resolve({ response, events: agent.recentEvents.slice(eventsBefore) });
			};

			const onLine = (line: string) => {
				if (agent.done) { finish(); return; }
				try {
					const evt = JSON.parse(line) as Record<string, unknown>;
					if (evt.type === "response" && evt.command === cmd.type) {
						response = evt;
						if (!waitForAgent) { finish(); return; }
					}
					if (waitForAgent && evt.type === "agent_end") { finish(); return; }
				} catch { /* not JSON */ }
			};

			const timer = setTimeout(finish, timeoutMs);
			agent.emitter.on("line", onLine);
			if (agent.done) finish();
		});
	}

	// ── spawn_agent ─────────────────────────────────────────────

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description:
			"Spawn a new pi agent in RPC mode. The agent stays alive and can receive " +
			"multiple tasks. It inherits global extensions (panopticon → socket IPC). " +
			"After spawning, send it a task with rpc_send, or use agent_send from any peer.",
		promptSnippet: "Spawn a persistent RPC agent with IPC",
		promptGuidelines: [
			"After spawn_agent, use rpc_send to give it a task (spawn only starts the process).",
			"Or use agent_send once it registers in panopticon (takes 1-2 seconds).",
			"Use agent_peek to monitor its activity log.",
		],
		parameters: Type.Object({
			name: Type.String({
				description: 'Unique name for the agent (e.g. "researcher", "test-runner")',
			}),
			task: Type.Optional(
				Type.String({ description: "Initial task/prompt. If omitted, agent starts idle — send a task later with rpc_send." }),
			),
			cwd: Type.Optional(
				Type.String({ description: "Working directory (default: current cwd)" }),
			),
			model: Type.Optional(
				Type.String({ description: 'Model (e.g. "anthropic/claude-sonnet-4-6"). Default: global default.' }),
			),
			tools: Type.Optional(
				Type.Array(Type.String(), { description: 'Restrict tools (e.g. ["read", "bash"]). Default: all.' }),
			),
			systemPrompt: Type.Optional(
				Type.String({ description: "Additional system prompt to append" }),
			),
			sessionDir: Type.Optional(
				Type.String({ description: "Session directory for persistence" }),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const existing = agents.get(params.name);
			if (existing && !existing.done) {
				return ok(
					`Agent "${params.name}" already running (pid ${existing.pid}). Use rpc_send to send it tasks.`,
					{ error: "already_running", pid: existing.pid },
				);
			}
			agents.delete(params.name); // clean up dead agent if present

			const agentCwd = params.cwd ?? process.cwd();
			const args = buildArgList(params);
			let tempDir: string | undefined;

			if (params.systemPrompt) {
				tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
				const promptPath = join(tempDir, "system-prompt.md");
				writeFileSync(promptPath, params.systemPrompt, { mode: 0o600 });
				args.push("--append-system-prompt", promptPath);
			}

			if (params.sessionDir) mkdirSync(params.sessionDir, { recursive: true });

			const proc = spawn(PI_BINARY, args, {
				cwd: agentCwd,
				stdio: ["pipe", "pipe", "pipe"],
				env: {
					...process.env,
					PI_SUBAGENT_DEPTH: String(Number(process.env.PI_SUBAGENT_DEPTH ?? "0") + 1),
					PI_SUBAGENT_MAX_DEPTH: process.env.PI_SUBAGENT_MAX_DEPTH ?? "3",
				},
			});

			if (!proc.pid) {
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
				return fail(`Failed to spawn agent "${params.name}".`, { error: "spawn_failed" });
			}

			const agent: SpawnedAgent = {
				name: params.name, proc, pid: proc.pid, cwd: agentCwd,
				model: params.model, startedAt: Date.now(),
				recentEvents: [], emitter: new EventEmitter(), tempDir, done: false,
			};
			agents.set(params.name, agent);

			// Wire up stdout → recentEvents + emitter
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

			const onExit = (code: number | null) => {
				agent.done = true;
				agent.recentEvents.push(`[process exited with code ${code}]`);
				agent.emitter.emit("line", JSON.stringify({ type: "process_exit", code }));
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			};

			proc.on("close", onExit);
			proc.on("error", (err) => {
				agent.done = true;
				agent.recentEvents.push(`[process error: ${err.message}]`);
				agent.emitter.emit("line", JSON.stringify({ type: "process_error", message: err.message }));
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			});

			proc.unref();
			if (params.task) rpcWrite(agent, { type: "prompt", message: params.task });

			return ok(
				`Spawned "${params.name}" in RPC mode (pid ${proc.pid})\n` +
				`  cwd: ${agentCwd}\n` +
				`  model: ${params.model ?? "(default)"}\n` +
				(params.task
					? `  task: ${params.task.slice(0, 100)}${params.task.length > 100 ? "…" : ""}\n`
					: `  (idle — use rpc_send to give it a task)\n`) +
				`\nAgent will register in panopticon within seconds.\n` +
				`Use rpc_send for direct RPC commands, agent_send from any peer.`,
				{ name: params.name, pid: proc.pid, cwd: agentCwd },
			);
		},
	});

	// ── rpc_send ────────────────────────────────────────────────

	pi.registerTool({
		name: "rpc_send",
		label: "RPC Send",
		description:
			"Send an RPC command to a spawned agent and return the response. Supports: " +
			"prompt (new task), steer (mid-task redirect), follow_up (after current task), " +
			"abort, get_state, get_messages, compact. " +
			"For get_state/abort/compact, returns the response immediately. " +
			"For prompt/steer/follow_up, set wait=true to wait for the agent to finish.",
		promptSnippet: "Send an RPC command to a spawned agent and get the response",
		parameters: Type.Object({
			name: Type.String({ description: "Agent name (as given to spawn_agent)" }),
			command: Type.String({
				description: 'RPC command type: "prompt", "steer", "follow_up", "abort", "get_state", "get_messages", "compact"',
			}),
			message: Type.Optional(
				Type.String({ description: "Message text (required for prompt, steer, follow_up)" }),
			),
			wait: Type.Optional(
				Type.Boolean({ description: "Wait for agent to finish processing (default: false for queries, true for prompt)", default: false }),
			),
			timeout: Type.Optional(
				Type.Number({ description: "Max seconds to wait for response (default: 30)", default: 30 }),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const agent = agents.get(params.name);
			if (!agent) {
				return fail(
					`No spawned agent named "${params.name}". Known: ${[...agents.keys()].join(", ") || "(none)"}`,
					{ error: "not_found" },
				);
			}
			if (agent.done) {
				return fail(
					`Agent "${params.name}" has exited.\n\nLast output:\n${recentOutputFromEvents(agent.recentEvents, 10)}`,
					{ error: "exited", exitCode: agent.proc.exitCode },
				);
			}

			const cmd: Record<string, unknown> = { type: params.command };
			if (params.message) cmd.message = params.message;

			const isAsync = ["prompt", "steer", "follow_up"].includes(params.command);
			const waitForAgent = params.wait ?? isAsync;
			const timeoutMs = (params.timeout ?? 30) * 1000;

			const { response, events } = await rpcCall(agent, cmd, { waitForAgent, timeoutMs });

			if (!response && events.length === 0) {
				return fail(`Failed to communicate with agent "${params.name}".`, { error: "write_failed" });
			}

			const responseSummary = response
				? JSON.stringify(response, null, 2).slice(0, 2000)
				: "(no response received — may have timed out)";

			const agentOutput = waitForAgent
				? events.map((line) => {
					try {
						const evt = JSON.parse(line) as Record<string, unknown>;
						if (evt.type === "message_update") {
							const d = evt.assistantMessageEvent as Record<string, unknown> | undefined;
							if (d?.type === "text_delta") return String(d.delta);
						}
					} catch { /* */ }
					return "";
				}).join("")
				: "";

			const parts = [
				`RPC ${params.command} → "${params.name}" (pid ${agent.pid})`,
				...(params.message ? [`  message: ${params.message.slice(0, 100)}${params.message.length > 100 ? "…" : ""}`] : []),
				"",
				`Response:\n${responseSummary}`,
				...(agentOutput ? ["", `Agent output:\n${agentOutput.slice(0, 3000)}`] : []),
			];

			return ok(parts.join("\n"), {
				name: params.name, command: params.command, response, eventCount: events.length,
			});
		},
	});

	// ── list_spawned ────────────────────────────────────────────

	pi.registerTool({
		name: "list_spawned",
		label: "List Spawned",
		description: "Show all agents spawned by this session, with their status and recent output.",
		promptSnippet: "List agents spawned by this session",
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Show detailed output for a specific agent" }),
			),
			lines: Type.Optional(
				Type.Number({ description: "Number of recent event lines to show (default 20)", default: 20 }),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			if (agents.size === 0) {
				return ok("No agents spawned in this session.", { count: 0 });
			}

			if (params.name) {
				const agent = agents.get(params.name);
				if (!agent) {
					return fail(
						`No agent named "${params.name}". Known: ${[...agents.keys()].join(", ")}`,
						{ error: "not_found" },
					);
				}
				const uptime = Math.round((Date.now() - agent.startedAt) / 1000);
				return ok(
					`Agent "${agent.name}" (pid ${agent.pid})\n` +
					`  status: ${agent.done ? `exited (code ${agent.proc.exitCode})` : "running"}\n` +
					`  uptime: ${uptime}s\n` +
					`  cwd: ${agent.cwd}\n` +
					`  model: ${agent.model ?? "(default)"}\n` +
					`  events: ${agent.recentEvents.length}\n\n` +
					`Recent output:\n${recentOutputFromEvents(agent.recentEvents, params.lines ?? 20)}`,
					{ name: agent.name, pid: agent.pid, done: agent.done },
				);
			}

			const rows = [...agents.values()].map((a) => {
				const status = a.done ? `✗ exited(${a.proc.exitCode})` : "● running";
				const uptime = Math.round((Date.now() - a.startedAt) / 1000);
				return `  ${status} ${a.name.padEnd(20)} pid=${a.pid}  up=${uptime}s  events=${a.recentEvents.length}`;
			});
			return ok(
				`${agents.size} spawned agent(s):\n${rows.join("\n")}\n\nUse list_spawned with a name for details.`,
				{ count: agents.size, agents: [...agents.keys()] },
			);
		},
	});

	// ── kill_agent ──────────────────────────────────────────────

	pi.registerTool({
		name: "kill_agent",
		label: "Kill Agent",
		description:
			"Stop a spawned agent. Sends abort via RPC, waits briefly, then SIGTERM/SIGKILL. " +
			"Removes the agent from the spawned list.",
		promptSnippet: "Stop and remove a spawned agent",
		parameters: Type.Object({
			name: Type.String({ description: "Agent name to kill" }),
			force: Type.Optional(
				Type.Boolean({ description: "Skip graceful abort, SIGKILL immediately (default: false)", default: false }),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const agent = agents.get(params.name);
			if (!agent) {
				return fail(
					`No spawned agent named "${params.name}". Known: ${[...agents.keys()].join(", ") || "(none)"}`,
					{ error: "not_found" },
				);
			}
			if (agent.done) {
				agents.delete(params.name);
				return ok(
					`Agent "${params.name}" already exited (code ${agent.proc.exitCode}). Removed from list.`,
					{ name: params.name, alreadyDead: true },
				);
			}

			const { pid } = agent;

			if (params.force) {
				try { agent.proc.kill("SIGKILL"); } catch { /* */ }
				agents.delete(params.name);
				return ok(`Force-killed "${params.name}" (pid ${pid}).`, { name: params.name, pid, method: "SIGKILL" });
			}

			// Graceful: abort → 2s → SIGTERM → 2s → SIGKILL
			rpcWrite(agent, { type: "abort" });
			const closed = new Promise<void>((res) => agent.proc.once("close", res));

			await Promise.race([closed, sleep(2000)]);
			if (!agent.done) {
				try { agent.proc.kill("SIGTERM"); } catch { /* */ }
				await Promise.race([closed, sleep(2000)]);
				if (!agent.done) try { agent.proc.kill("SIGKILL"); } catch { /* */ }
			}

			agents.delete(params.name);
			return ok(
				`Stopped "${params.name}" (pid ${pid}). Exit code: ${agent.proc.exitCode ?? "killed"}.`,
				{ name: params.name, pid, exitCode: agent.proc.exitCode },
			);
		},
	});

	// ── Cleanup ─────────────────────────────────────────────────

	pi.on("session_shutdown", async () => {
		for (const agent of agents.values()) {
			if (!agent.done) {
				rpcWrite(agent, { type: "abort" });
				const p = agent.proc;
				setTimeout(() => { if (!agent.done) try { p.kill("SIGTERM"); } catch { /* */ } }, 2000);
			}
		}
	});
}
