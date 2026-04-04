/**
 * spawner — Agent spawner with RPC + IPC
 *
 * Spawns pi agents in --mode rpc, giving us:
 * 1. Bidirectional stdin/stdout JSON protocol (prompt, steer, abort, get_state)
 * 2. Global extensions inherited (panopticon → IPC from any agent)
 * 3. Agent stays alive — send multiple tasks without respawning
 * 4. Two communication channels:
 *    - RPC stdin  (from parent, structured commands)
 *    - Maildir    (from any peer, via agent_send)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, fail, type ToolResult } from "./types.js";
import {
	sleep,
	recentOutputFromEvents,
	buildArgList,
	spawnChild,
	type SpawnedAgent,
} from "./spawner-utils.js";
import {
	TaskBriefSchema,
	routeBrief,
	renderBriefAsPrompt,
	type TaskBrief,
} from "../../lib/task-brief.js";

// ── SpawnerModule interface ─────────────────────────────────────

interface SpawnerModule {
	shutdownAll(): Promise<void>;
}

// ── Extension entry ─────────────────────────────────────────────

export function setupSpawner(pi: ExtensionAPI): SpawnerModule {
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
			"Spawn a new pi agent in RPC mode. Accepts either a plain 'task' string or a structured 'brief' " +
			"with classification, goal, success criteria, and scope. When 'brief' is provided, the model is " +
			"auto-routed by classification and topology mismatches are flagged.",
		promptSnippet: "Spawn a persistent RPC agent with IPC. Prefer 'brief' over 'task' for structured dispatch.",
		promptGuidelines: [
			"Prefer 'brief' over 'task' — it enforces structure and auto-routes model/topology.",
			"brief.classification: sequential (code, debug), parallelisable (research, scan), high-entropy-search, tool-heavy.",
			"Sequential tasks: single agent always. Parallelisable: centralised-mas with WIP=3.",
			"After spawn_agent, use rpc_send to give it a task (spawn only starts the process).",
			"Or use agent_send once it registers in panopticon (takes 1-2 seconds).",
			"Use agent_peek to monitor its activity log.",
		],
		parameters: Type.Object({
			name: Type.String({
				description: 'Unique name for the agent (e.g. "researcher", "test-runner")',
			}),
			task: Type.Optional(
				Type.String({ description: "Initial task as plain text. Mutually exclusive with 'brief'." }),
			),
			brief: Type.Optional(
				TaskBriefSchema,
			),
			cwd: Type.Optional(
				Type.String({ description: "Working directory (default: current cwd)" }),
			),
			model: Type.Optional(
				Type.String({ description: 'Model override. If brief is provided, model is auto-routed from classification unless this is set.' }),
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
			if (params.task && params.brief) {
				return fail(
					"Cannot specify both 'task' and 'brief'. Use 'brief' for structured dispatch, 'task' for plain text.",
					{ error: "mutually_exclusive" },
				);
			}

			const existing = agents.get(params.name);
			if (existing && !existing.done) {
				return ok(
					`Agent "${params.name}" already running (pid ${existing.pid}). Use rpc_send to send it tasks.`,
					{ error: "already_running", pid: existing.pid },
				);
			}
			agents.delete(params.name);

			// Route model and topology from brief, or use explicit params
			const brief = params.brief as TaskBrief | undefined;
			let routing: ReturnType<typeof routeBrief> | undefined;
			let resolvedModel = params.model;
			let taskPrompt = params.task;

			if (brief) {
				routing = routeBrief(brief);
				resolvedModel = params.model ?? routing.model;
				taskPrompt = renderBriefAsPrompt(brief);
			}

			const agentCwd = params.cwd ?? process.cwd();
			const args = buildArgList({ ...params, model: resolvedModel });
			let tempDir: string | undefined;

			if (params.systemPrompt) {
				tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
				const promptPath = join(tempDir, "system-prompt.md");
				writeFileSync(promptPath, params.systemPrompt, { mode: 0o600 });
				args.push("--append-system-prompt", promptPath);
			}

			if (params.sessionDir) mkdirSync(params.sessionDir, { recursive: true });

			const agent = spawnChild({ name: params.name, cwd: agentCwd, args, model: resolvedModel, tempDir });
			if (!agent.pid) {
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
				return fail(`Failed to spawn agent "${params.name}".`, { error: "spawn_failed" });
			}

			if (taskPrompt) rpcWrite(agent, { type: "prompt", message: taskPrompt });
			agents.set(params.name, agent);

			// Build response with routing info
			const lines = [
				`Spawned "${params.name}" in RPC mode (pid ${agent.pid})`,
				`  cwd: ${agentCwd}`,
				`  model: ${resolvedModel ?? "(default)"}`,
			];

			if (routing) {
				lines.push(
					`  classification: ${brief?.classification}`,
					`  topology: ${routing.recommendedTopology}`,
				);
				for (const w of routing.warnings) lines.push(`  ${w}`);
			}

			if (taskPrompt) {
				lines.push(`  task: ${taskPrompt.slice(0, 100)}${taskPrompt.length > 100 ? "…" : ""}`);
			} else {
				lines.push("  (idle — use rpc_send to give it a task)");
			}

			lines.push("", "Agent will register in panopticon within seconds.");
			lines.push("Use rpc_send for direct RPC commands, agent_send from any peer.");

			return ok(lines.join("\n"), {
				name: params.name,
				pid: agent.pid,
				cwd: agentCwd,
				...(routing && {
					routing: {
						model: routing.model,
						topology: routing.recommendedTopology,
						warnings: routing.warnings,
					},
				}),
			});
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

	// ── Return module interface ─────────────────────────────────

	return {
		async shutdownAll(): Promise<void> {
			const pending: Promise<void>[] = [];
			for (const agent of agents.values()) {
				if (agent.done) continue;
				rpcWrite(agent, { type: "abort" });
				const p = agent.proc;
				const closed = new Promise<void>((res) => p.once("close", res));
				pending.push(
					Promise.race([closed, sleep(2000)]).then(async () => {
						if (!agent.done) {
							try { p.kill("SIGTERM"); } catch { /* */ }
							await Promise.race([closed, sleep(2000)]);
							if (!agent.done) try { p.kill("SIGKILL"); } catch { /* */ }
						}
					}),
				);
			}
			await Promise.all(pending);
		},
	};
}
