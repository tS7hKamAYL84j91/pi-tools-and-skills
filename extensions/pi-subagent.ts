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
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn, type ChildProcess } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────

interface SpawnedAgent {
	name: string;
	proc: ChildProcess;
	pid: number;
	cwd: string;
	model?: string;
	startedAt: number;
	recentEvents: string[];
	tempDir?: string;
	done: boolean;
}

// ── Constants ───────────────────────────────────────────────────

const MAX_RECENT_EVENTS = 100;

// ── Extension entry ─────────────────────────────────────────────

type ToolResult = {
	content: { type: "text"; text: string }[];
	details: Record<string, unknown>;
	isError?: boolean;
};

export default function (pi: ExtensionAPI) {
	const agents = new Map<string, SpawnedAgent>();

	/** Send a JSON command to an agent's stdin. */
	function rpcWrite(agent: SpawnedAgent, cmd: Record<string, unknown>): boolean {
		if (agent.done || !agent.proc.stdin?.writable) return false;
		agent.proc.stdin.write(JSON.stringify(cmd) + "\n");
		return true;
	}

	/**
	 * Send an RPC command and wait for the response event.
	 * RPC responses have {type: "response", command: "...", success: true/false, ...}
	 * For commands like "prompt" that trigger async work, also captures streaming
	 * events until agent_end.
	 */
	function rpcCall(
		agent: SpawnedAgent,
		cmd: Record<string, unknown>,
		opts: { waitForAgent?: boolean; timeoutMs?: number } = {},
	): Promise<{ response: Record<string, unknown> | null; events: string[] }> {
		const { waitForAgent = false, timeoutMs = 30_000 } = opts;
		return new Promise((resolve) => {
			const eventsBefore = agent.recentEvents.length;
			const ok = rpcWrite(agent, cmd);
			if (!ok) {
				resolve({ response: null, events: [] });
				return;
			}

			let resolved = false;
			let response: Record<string, unknown> | null = null;

			const timer = setTimeout(() => finish(), timeoutMs);

			function finish() {
				if (resolved) return;
				resolved = true;
				clearTimeout(timer);
				clearInterval(poller);
				const newEvents = agent.recentEvents.slice(eventsBefore);
				resolve({ response, events: newEvents });
			}

			// Poll for response/agent_end in the event stream
			const poller = setInterval(() => {
				if (agent.done) { finish(); return; }

				// Scan new events since we sent the command
				for (let i = eventsBefore; i < agent.recentEvents.length; i++) {
					try {
						const evt = JSON.parse(agent.recentEvents[i]!);
						if (evt.type === "response" && evt.command === cmd.type) {
							response = evt;
							if (!waitForAgent) { finish(); return; }
						}
						if (waitForAgent && evt.type === "agent_end") {
							finish(); return;
						}
					} catch { /* not json */ }
				}
			}, 100);
		});
	}

	/** Read recent events, formatted as text. */
	function recentOutput(agent: SpawnedAgent, lines = 20): string {
		const recent = agent.recentEvents.slice(-lines);
		if (recent.length === 0) return "(no events yet)";
		return recent.map((line) => {
			try {
				const evt = JSON.parse(line);
				const t = evt.type ?? "?";
				// Compact formatting for common events
				if (t === "message_update") {
					const delta = evt.assistantMessageEvent;
					if (delta?.type === "text_delta") return delta.delta;
					return "";
				}
				if (t === "tool_execution_start") return `\n⚙ ${evt.toolName}(${JSON.stringify(evt.args ?? {}).slice(0, 80)})`;
				if (t === "tool_execution_end") return `  → ${evt.result?.content?.[0]?.text?.slice(0, 100) ?? "(done)"}`;
				if (t === "agent_start") return "\n▶ agent started";
				if (t === "agent_end") return "\n■ agent finished";
				if (t === "response") return `  [${evt.command}: ${evt.success ? "ok" : evt.error}]`;
				return `  [${t}]`;
			} catch {
				return line.slice(0, 120);
			}
		}).filter(Boolean).join("");
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
			if (agents.has(params.name)) {
				const existing = agents.get(params.name)!;
				if (!existing.done) {
					return {
						content: [{ type: "text" as const, text: `Agent "${params.name}" already running (pid ${existing.pid}). Use rpc_send to send it tasks.` }],
						details: { error: "already_running", pid: existing.pid },
					};
				}
				// Dead agent — clean up and respawn
				agents.delete(params.name);
			}

			const agentCwd = params.cwd ?? process.cwd();
			const args: string[] = ["--mode", "rpc"];
			let tempDir: string | undefined;

			if (params.model) args.push("--models", params.model);
			if (params.tools?.length) args.push("--tools", params.tools.join(","));

			if (params.systemPrompt) {
				tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
				const promptPath = join(tempDir, "system-prompt.md");
				writeFileSync(promptPath, params.systemPrompt, { mode: 0o600 });
				args.push("--append-system-prompt", promptPath);
			}

			if (params.sessionDir) {
				mkdirSync(params.sessionDir, { recursive: true });
				args.push("--session-dir", params.sessionDir);
			} else {
				args.push("--no-session");
			}

			// NOTE: No --no-extensions — global config flows through
			// → panopticon loads → agent gets a socket → IPC works

			const proc = spawn("pi", args, {
				cwd: agentCwd,
				stdio: ["pipe", "pipe", "pipe"],  // stdin for RPC commands
				env: {
					...process.env,
					PI_SUBAGENT_DEPTH: String(Number(process.env.PI_SUBAGENT_DEPTH ?? "0") + 1),
					PI_SUBAGENT_MAX_DEPTH: process.env.PI_SUBAGENT_MAX_DEPTH ?? "3",
				},
			});

			if (!proc.pid) {
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
				return {
					content: [{ type: "text" as const, text: `Failed to spawn agent "${params.name}".` }],
					details: { error: "spawn_failed" },
				};
			}

			const agent: SpawnedAgent = {
				name: params.name,
				proc,
				pid: proc.pid,
				cwd: agentCwd,
				model: params.model,
				startedAt: Date.now(),
				recentEvents: [],
				tempDir,
				done: false,
			};
			agents.set(params.name, agent);

			// Capture stdout events (JSONL)
			let buf = "";
			proc.stdout?.on("data", (chunk: Buffer) => {
				buf += chunk.toString();
				const lines = buf.split("\n");
				buf = lines.pop() ?? "";
				for (const line of lines) {
					if (line.trim()) {
						agent.recentEvents.push(line);
						if (agent.recentEvents.length > MAX_RECENT_EVENTS) {
							agent.recentEvents.shift();
						}
					}
				}
			});

			proc.stderr?.on("data", (chunk: Buffer) => {
				agent.recentEvents.push(`[stderr] ${chunk.toString().trim()}`);
			});

			proc.on("close", (code) => {
				agent.done = true;
				agent.recentEvents.push(`[process exited with code ${code}]`);
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			});

			proc.on("error", (err) => {
				agent.done = true;
				agent.recentEvents.push(`[process error: ${err.message}]`);
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			});

			proc.unref();

			// If an initial task was provided, send it
			if (params.task) {
				rpcWrite(agent, { type: "prompt", message: params.task });
			}

			return {
				content: [{
					type: "text" as const,
					text: `Spawned "${params.name}" in RPC mode (pid ${proc.pid})\n` +
						`  cwd: ${agentCwd}\n` +
						`  model: ${params.model ?? "(default)"}\n` +
						(params.task
							? `  task: ${params.task.slice(0, 100)}${params.task.length > 100 ? "…" : ""}\n`
							: `  (idle — use rpc_send to give it a task)\n`) +
						`\nAgent will register in panopticon within seconds.\n` +
						`Use rpc_send for direct RPC commands, agent_send from any peer.`,
				}],
				details: { name: params.name, pid: proc.pid, cwd: agentCwd },
			};
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
				return {
					content: [{ type: "text" as const, text: `No spawned agent named "${params.name}". Known: ${[...agents.keys()].join(", ") || "(none)"}` }],
					details: { error: "not_found" },
				};
			}
			if (agent.done) {
				return {
					content: [{
						type: "text" as const,
						text: `Agent "${params.name}" has exited.\n\nLast output:\n${recentOutput(agent, 10)}`,
					}],
					details: { error: "exited", exitCode: agent.proc.exitCode },
				};
			}

			const cmd: Record<string, unknown> = { type: params.command };
			if (params.message) cmd.message = params.message;

			// Determine if we should wait for agent_end
			const isAsync = ["prompt", "steer", "follow_up"].includes(params.command);
			const waitForAgent = params.wait ?? isAsync;
			const timeoutMs = (params.timeout ?? 30) * 1000;

			const { response, events } = await rpcCall(agent, cmd, { waitForAgent, timeoutMs });

			if (!response && events.length === 0) {
				return {
					content: [{ type: "text" as const, text: `Failed to communicate with agent "${params.name}".` }],
					details: { error: "write_failed" },
				};
			}

			// Format response
			const responseSummary = response
				? JSON.stringify(response, null, 2).slice(0, 2000)
				: "(no response received — may have timed out)";

			// Extract text output from events if we waited
			let agentOutput = "";
			if (waitForAgent && events.length > 0) {
				agentOutput = events.map((line) => {
					try {
						const evt = JSON.parse(line);
						if (evt.type === "message_update" && evt.assistantMessageEvent?.type === "text_delta") {
							return evt.assistantMessageEvent.delta;
						}
					} catch { /* */ }
					return "";
				}).join("");
			}

			const parts: string[] = [
				`RPC ${params.command} → "${params.name}" (pid ${agent.pid})`,
			];
			if (params.message) parts.push(`  message: ${params.message.slice(0, 100)}${params.message.length > 100 ? "…" : ""}`);
			parts.push("", `Response:\n${responseSummary}`);
			if (agentOutput) parts.push("", `Agent output:\n${agentOutput.slice(0, 3000)}`);

			return {
				content: [{ type: "text" as const, text: parts.join("\n") }],
				details: { name: params.name, command: params.command, response, eventCount: events.length },
			};
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
				return {
					content: [{ type: "text" as const, text: "No agents spawned in this session." }],
					details: { count: 0 },
				};
			}

			// Detail view for one agent
			if (params.name) {
				const agent = agents.get(params.name);
				if (!agent) {
					return {
						content: [{ type: "text" as const, text: `No agent named "${params.name}". Known: ${[...agents.keys()].join(", ")}` }],
						details: { error: "not_found" },
					};
				}
				const uptime = Math.round((Date.now() - agent.startedAt) / 1000);
				const output = recentOutput(agent, params.lines ?? 20);
				return {
					content: [{
						type: "text" as const,
						text: `Agent "${agent.name}" (pid ${agent.pid})\n` +
							`  status: ${agent.done ? `exited (code ${agent.proc.exitCode})` : "running"}\n` +
							`  uptime: ${uptime}s\n` +
							`  cwd: ${agent.cwd}\n` +
							`  model: ${agent.model ?? "(default)"}\n` +
							`  events: ${agent.recentEvents.length}\n\n` +
							`Recent output:\n${output}`,
					}],
					details: { name: agent.name, pid: agent.pid, done: agent.done },
				};
			}

			// Summary view
			const lines = [...agents.values()].map((a) => {
				const status = a.done ? `✗ exited(${a.proc.exitCode})` : "● running";
				const uptime = Math.round((Date.now() - a.startedAt) / 1000);
				return `  ${status} ${a.name.padEnd(20)} pid=${a.pid}  up=${uptime}s  events=${a.recentEvents.length}`;
			});

			return {
				content: [{
					type: "text" as const,
					text: `${agents.size} spawned agent(s):\n${lines.join("\n")}\n\nUse list_spawned with a name for details.`,
				}],
				details: { count: agents.size, agents: [...agents.keys()] },
			};
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
				return {
					content: [{ type: "text" as const, text: `No spawned agent named "${params.name}". Known: ${[...agents.keys()].join(", ") || "(none)"}` }],
					details: { error: "not_found" },
				};
			}

			if (agent.done) {
				agents.delete(params.name);
				return {
					content: [{ type: "text" as const, text: `Agent "${params.name}" already exited (code ${agent.proc.exitCode}). Removed from list.` }],
					details: { name: params.name, alreadyDead: true },
				};
			}

			const pid = agent.pid;

			if (params.force) {
				try { agent.proc.kill("SIGKILL"); } catch { /* */ }
				agents.delete(params.name);
				return {
					content: [{ type: "text" as const, text: `Force-killed "${params.name}" (pid ${pid}).` }],
					details: { name: params.name, pid, method: "SIGKILL" },
				};
			}

			// Graceful: abort RPC → wait 2s → SIGTERM → wait 2s → SIGKILL
			rpcWrite(agent, { type: "abort" });

			await new Promise<void>((resolve) => {
				if (agent.done) { resolve(); return; }

				const onClose = () => { clearTimeout(t1); resolve(); };
				agent.proc.once("close", onClose);

				const t1 = setTimeout(() => {
					if (agent.done) { resolve(); return; }
					try { agent.proc.kill("SIGTERM"); } catch { /* */ }

					setTimeout(() => {
						if (!agent.done) {
							try { agent.proc.kill("SIGKILL"); } catch { /* */ }
						}
						agent.proc.removeListener("close", onClose);
						resolve();
					}, 2000);
				}, 2000);
			});

			agents.delete(params.name);

			return {
				content: [{ type: "text" as const, text: `Stopped "${params.name}" (pid ${pid}). Exit code: ${agent.proc.exitCode ?? "killed"}.` }],
				details: { name: params.name, pid, exitCode: agent.proc.exitCode },
			};
		},
	});

	// ── Cleanup ─────────────────────────────────────────────────

	pi.on("session_shutdown", async () => {
		for (const agent of agents.values()) {
			if (!agent.done) {
				try {
					rpcWrite(agent, { type: "abort" });
					// Give it a moment, then kill
					setTimeout(() => {
						if (!agent.done) try { agent.proc.kill("SIGTERM"); } catch { /* */ }
					}, 2000);
				} catch { /* */ }
			}
		}
	});
}
