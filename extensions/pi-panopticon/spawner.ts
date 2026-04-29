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
import { ok, fail, type ToolResult, type Registry } from "./types.js";
import {
	PANOPTICON_PARENT_ID_ENV,
	PANOPTICON_VISIBILITY_ENV,
} from "../../lib/agent-registry.js";
import {
	buildArgList,
	spawnChild,
	gracefulKill,
	type SpawnedAgent,
} from "../../lib/spawn-service.js";
import { rpcWrite, rpcCall } from "../../lib/spawn-rpc.js";
import { recentOutputFromEvents, hasCompletionSignal } from "../../lib/spawn-events.js";
import {
	TaskBriefSchema,
	renderBriefAsPrompt,
	type TaskBrief,
} from "../../lib/task-brief.js";

// ── SpawnerModule interface ─────────────────────────────────────

/** Callback invoked when a spawned agent exits without sending a completion signal. */
type MissingDoneCallback = (agentName: string, pid: number, exitCode: number | null, durationMs: number) => void;

interface SpawnerModule {
	shutdownAll(): Promise<void>;
	/** Register a listener for missing-DONE detection. Returns dispose function. */
	onMissingDone(cb: MissingDoneCallback): () => void;
}

interface ResultEnvelope {
	tool: string;
	params: Record<string, unknown>;
	result: Record<string, unknown>;
	durationMs: number;
	success: boolean;
	error?: string;
}

interface SpawnAgentParams {
	name: string;
	task?: string;
	brief?: TaskBrief;
	cwd?: string;
	model?: string;
	tools?: string[];
	systemPrompt?: string;
	sessionDir?: string;
}

function createResultEnvelope(args: {
	tool: string;
	params: Record<string, unknown>;
	result: Record<string, unknown>;
	startedAt: number;
	success: boolean;
	error?: string;
}): ResultEnvelope {
	return {
		tool: args.tool,
		params: args.params,
		result: args.result,
		durationMs: Date.now() - args.startedAt,
		success: args.success,
		...(args.error ? { error: args.error } : {}),
	};
}

/** Normalize legacy/model-emitted spawn_agent args before TypeBox validation. */
function prepareSpawnAgentArguments(args: unknown): SpawnAgentParams {
	if (args == null || typeof args !== "object" || Array.isArray(args)) {
		// Preserve invalid shapes for the schema validator to reject.
		return args as SpawnAgentParams;
	}
	// Tool arguments arrive as unknown JSON; object guard makes record access safe.
	const input = args as Record<string, unknown>;
	if (input.tools !== null) {
		// Preserve any other validation errors for the schema validator.
		return input as unknown as SpawnAgentParams;
	}
	return { ...input, tools: [] } as unknown as SpawnAgentParams;
}

// ── Extension entry ─────────────────────────────────────────────

export function setupSpawner(pi: ExtensionAPI, registry: Registry): SpawnerModule {
	const agents = new Map<string, SpawnedAgent>();
	const signalledAgents = new Set<string>();
	const missingDoneListeners = new Set<MissingDoneCallback>();

	/** Called when a spawned agent's process exits. Checks for missing DONE. */
	function onAgentExit(agent: SpawnedAgent): void {
		if (hasCompletionSignal(agent, signalledAgents)) return;
		const durationMs = Date.now() - agent.startedAt;
		for (const cb of missingDoneListeners) {
			try { cb(agent.name, agent.pid, agent.proc.exitCode ?? null, durationMs); } catch { /* best-effort */ }
		}
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
			"Or use agent_send once it registers in panopticon (takes 1–2 seconds).",
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
				Type.Array(Type.String(), { description: 'Restrict tools (e.g. ["read", "bash"]). Default: all. Null is normalized to omitted before validation.' }),
			),
			systemPrompt: Type.Optional(
				Type.String({ description: "Additional system prompt to append" }),
			),
			sessionDir: Type.Optional(
				Type.String({ description: "Session directory for persistence" }),
			),
		}),
		prepareArguments: prepareSpawnAgentArguments,

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const startedAt = Date.now();
			if (params.task && params.brief) {
				return fail(
					"Cannot specify both 'task' and 'brief'. Use 'brief' for structured dispatch, 'task' for plain text.",
					{
						error: "mutually_exclusive",
						envelope: createResultEnvelope({ tool: "spawn_agent", params, result: { code: "mutually_exclusive" }, startedAt, success: false, error: "mutually_exclusive" }),
					},
				);
			}

			const existing = agents.get(params.name);
			if (existing && !existing.done) {
				return ok(
					`Agent "${params.name}" already running (pid ${existing.pid}). Use rpc_send to send it tasks.`,
					{
						error: "already_running",
						pid: existing.pid,
						envelope: createResultEnvelope({ tool: "spawn_agent", params, result: { pid: existing.pid, status: "already_running" }, startedAt, success: true }),
					},
				);
			}
			agents.delete(params.name);

			const brief = params.brief as TaskBrief | undefined;
			const taskPrompt = brief ? renderBriefAsPrompt(brief) : params.task;

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

			const agent = spawnChild({
				name: params.name,
				cwd: agentCwd,
				args,
				model: params.model,
				tempDir,
				env: {
					...process.env,
					[PANOPTICON_PARENT_ID_ENV]: registry.selfId,
					[PANOPTICON_VISIBILITY_ENV]: "scoped",
				},
			});
			if (!agent.pid) {
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
				return fail(`Failed to spawn agent "${params.name}".`, {
					error: "spawn_failed",
					envelope: createResultEnvelope({ tool: "spawn_agent", params, result: { code: "spawn_failed" }, startedAt, success: false, error: "spawn_failed" }),
				});
			}

			if (taskPrompt) rpcWrite(agent, { type: "prompt", message: taskPrompt });
			agents.set(params.name, agent);

			// Wire missing-DONE detection on exit
			agent.emitter.on("line", (line: string) => {
				try {
					const evt = JSON.parse(line) as Record<string, unknown>;
					if (evt.type === "process_exit" || evt.type === "process_error") {
						onAgentExit(agent);
					}
				} catch { /* not JSON */ }
			});

			return ok(
				`Spawned "${params.name}" in RPC mode (pid ${agent.pid})\n` +
				`  cwd: ${agentCwd}\n` +
				`  model: ${params.model ?? "(default)"}\n` +
				(taskPrompt
					? `  task: ${taskPrompt.slice(0, 100)}${taskPrompt.length > 100 ? "…" : ""}\n`
					: `  (idle — use rpc_send to give it a task)\n`) +
				`\nAgent will register in panopticon within seconds.\n` +
				`Use rpc_send for direct RPC commands, agent_send from any peer.`,
				{
					name: params.name,
					pid: agent.pid,
					cwd: agentCwd,
					envelope: createResultEnvelope({ tool: "spawn_agent", params, result: { name: params.name, pid: agent.pid, cwd: agentCwd }, startedAt, success: true }),
				},
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
			const startedAt = Date.now();
			const agent = agents.get(params.name);
			if (!agent) {
				return fail(
					`No spawned agent named "${params.name}". Known: ${[...agents.keys()].join(", ") || "(none)"}`,
					{
						error: "not_found",
						envelope: createResultEnvelope({ tool: "rpc_send", params, result: { code: "not_found" }, startedAt, success: false, error: "not_found" }),
					},
				);
			}
			if (agent.done) {
				return fail(
					`Agent "${params.name}" has exited.\n\nLast output:\n${recentOutputFromEvents(agent.recentEvents, 10)}`,
					{
						error: "exited",
						exitCode: agent.proc.exitCode,
						envelope: createResultEnvelope({ tool: "rpc_send", params, result: { code: "exited", exitCode: agent.proc.exitCode ?? null }, startedAt, success: false, error: "exited" }),
					},
				);
			}

			const cmd: Record<string, unknown> = { type: params.command };
			if (params.message) cmd.message = params.message;

			const isAsync = ["prompt", "steer", "follow_up"].includes(params.command);
			const waitForAgent = params.wait ?? isAsync;
			const timeoutMs = (params.timeout ?? 30) * 1000;

			const { response, events } = await rpcCall(agent, cmd, { waitForAgent, timeoutMs });

			if (!response && events.length === 0) {
				return fail(`Failed to communicate with agent "${params.name}".`, {
					error: "write_failed",
					envelope: createResultEnvelope({ tool: "rpc_send", params, result: { code: "write_failed" }, startedAt, success: false, error: "write_failed" }),
				});
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
					} catch { /* not JSON — skip */ }
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
				name: params.name,
				command: params.command,
				response,
				eventCount: events.length,
				envelope: createResultEnvelope({
					tool: "rpc_send",
					params,
					result: { response: response ?? {}, eventCount: events.length, waited: waitForAgent },
					startedAt,
					success: true,
				}),
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
				try { agent.proc.kill("SIGKILL"); } catch { /* already exited */ }
				agents.delete(params.name);
				return ok(`Force-killed "${params.name}" (pid ${pid}).`, { name: params.name, pid, method: "SIGKILL" });
			}

			await gracefulKill(agent, (a) => rpcWrite(a, { type: "abort" }));
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
			const writeAbort = (a: SpawnedAgent) => rpcWrite(a, { type: "abort" });
			const pending = [...agents.values()]
				.filter((a) => !a.done)
				.map((a) => gracefulKill(a, writeAbort));
			await Promise.all(pending);
		},

		onMissingDone(cb: MissingDoneCallback): () => void {
			missingDoneListeners.add(cb);
			return () => { missingDoneListeners.delete(cb); };
		},
	};
}
