/**
 * spawn-agent — Minimal agent spawner with IPC
 *
 * Spawns a pi agent as a child process that:
 * 1. Inherits global extensions (panopticon gets loaded → socket IPC works)
 * 2. Runs in print mode (-p) — processes task and exits
 * 3. Streams structured JSON events on stdout
 * 4. Registers in panopticon → visible to agent_peek / agent_send
 *
 * Unlike pi-subagents which uses --mode json and may strip extensions,
 * this spawner keeps things simple: global config is inherited, the
 * agent gets a socket, and we can talk to it.
 *
 * Usage (from LLM):
 *   spawn_agent({ name: "researcher", task: "Find papers on X", cwd: "/path" })
 *
 * The spawned agent appears in agent_peek and can receive messages via agent_send.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { spawn, type ChildProcess } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Types ───────────────────────────────────────────────────────

interface SpawnedAgent {
	id: string;
	name: string;
	proc: ChildProcess;
	pid: number;
	cwd: string;
	task: string;
	model?: string;
	startedAt: number;
	outputLines: string[];
	exitCode: number | null;
	done: boolean;
}

// ── Constants ───────────────────────────────────────────────────

const MAX_OUTPUT_LINES = 500;
const TASK_ARG_LIMIT = 8000;

// ── Extension entry ─────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const spawned = new Map<string, SpawnedAgent>();

	/** Build the pi CLI args for spawning. Minimal — inherits global config. */
	function buildArgs(opts: {
		task: string;
		model?: string;
		tools?: string[];
		skills?: string[];
		systemPrompt?: string;
		sessionDir?: string;
	}): { args: string[]; tempDir?: string } {
		const args: string[] = ["-p"]; // print mode: run task, exit
		let tempDir: string | undefined;

		// Model
		if (opts.model) {
			args.push("--models", opts.model);
		}

		// Tools (restrict if specified, otherwise inherit all)
		if (opts.tools?.length) {
			args.push("--tools", opts.tools.join(","));
		}

		// Skills
		if (opts.skills?.length) {
			for (const skill of opts.skills) {
				args.push("--skill", skill);
			}
		}

		// System prompt (write to temp file, pass via --append-system-prompt)
		if (opts.systemPrompt) {
			tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
			const promptPath = join(tempDir, "system-prompt.md");
			writeFileSync(promptPath, opts.systemPrompt, { mode: 0o600 });
			args.push("--append-system-prompt", promptPath);
		}

		// Session
		if (opts.sessionDir) {
			mkdirSync(opts.sessionDir, { recursive: true });
			args.push("--session-dir", opts.sessionDir);
		} else {
			args.push("--no-session");
		}

		// Task — inline or via file if too long
		if (opts.task.length > TASK_ARG_LIMIT) {
			if (!tempDir) tempDir = mkdtempSync(join(tmpdir(), "pi-spawn-"));
			const taskPath = join(tempDir, "task.md");
			writeFileSync(taskPath, opts.task, { mode: 0o600 });
			args.push(`@${taskPath}`);
		} else {
			args.push(opts.task);
		}

		// NOTE: We do NOT pass --no-extensions or --extension
		// This means global extensions from settings.json load automatically
		// → panopticon loads → agent gets a socket → IPC works

		return { args, tempDir };
	}

	// ── spawn_agent tool ────────────────────────────────────────

	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description:
			"Spawn a new pi agent as a background process. The agent inherits global extensions " +
			"(including panopticon) so it gets a socket for IPC. Use agent_peek to monitor and " +
			"agent_send to communicate with it.",
		promptSnippet: "Spawn a background pi agent that registers in panopticon for IPC",
		promptGuidelines: [
			"After spawning, use agent_peek to find the agent once it registers (may take a few seconds).",
			"Use agent_send to send follow-up instructions to a running agent.",
			"The agent runs independently — you don't need to wait for it to finish.",
		],
		parameters: Type.Object({
			name: Type.String({
				description: 'Human-readable name for the agent (e.g. "researcher", "test-runner")',
			}),
			task: Type.String({
				description: "The task/prompt to give the agent",
			}),
			cwd: Type.Optional(
				Type.String({ description: "Working directory for the agent (default: current cwd)" }),
			),
			model: Type.Optional(
				Type.String({ description: 'Model to use (e.g. "anthropic/claude-sonnet-4-6"). Defaults to global default.' }),
			),
			tools: Type.Optional(
				Type.Array(Type.String(), { description: 'Restrict to specific tools (e.g. ["read", "bash"]). Default: all tools.' }),
			),
			skills: Type.Optional(
				Type.Array(Type.String(), { description: "Skills to inject" }),
			),
			systemPrompt: Type.Optional(
				Type.String({ description: "Additional system prompt to append" }),
			),
			sessionDir: Type.Optional(
				Type.String({ description: "Session directory for persistence. Default: no session." }),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const agentCwd = params.cwd ?? process.cwd();
			const { args, tempDir } = buildArgs({
				task: params.task,
				model: params.model,
				tools: params.tools,
				skills: params.skills,
				systemPrompt: params.systemPrompt,
				sessionDir: params.sessionDir,
			});

			// Spawn the process
			const proc = spawn("pi", args, {
				cwd: agentCwd,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					// Depth guard (prevent recursive spawning)
					PI_SUBAGENT_DEPTH: String(Number(process.env.PI_SUBAGENT_DEPTH ?? "0") + 1),
					PI_SUBAGENT_MAX_DEPTH: process.env.PI_SUBAGENT_MAX_DEPTH ?? "3",
				},
				detached: false,
			});

			if (!proc.pid) {
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
				return {
					content: [{ type: "text" as const, text: `Failed to spawn agent "${params.name}".` }],
					details: { error: "spawn_failed" },
				};
			}

			const agent: SpawnedAgent = {
				id: `${proc.pid}-${Date.now().toString(36)}`,
				name: params.name,
				proc,
				pid: proc.pid,
				cwd: agentCwd,
				task: params.task.slice(0, 200),
				model: params.model,
				startedAt: Date.now(),
				outputLines: [],
				exitCode: null,
				done: false,
			};
			spawned.set(params.name, agent);

			// Capture output
			proc.stdout?.on("data", (chunk: Buffer) => {
				const lines = chunk.toString().split("\n").filter((l) => l.trim());
				agent.outputLines.push(...lines);
				if (agent.outputLines.length > MAX_OUTPUT_LINES) {
					agent.outputLines.splice(0, agent.outputLines.length - MAX_OUTPUT_LINES);
				}
			});
			proc.stderr?.on("data", (chunk: Buffer) => {
				agent.outputLines.push(`[stderr] ${chunk.toString().trim()}`);
			});

			proc.on("close", (code) => {
				agent.exitCode = code;
				agent.done = true;
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			});

			proc.on("error", () => {
				agent.done = true;
				agent.exitCode = 1;
				if (tempDir) try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* */ }
			});

			// Don't keep parent alive waiting for child
			proc.unref();

			return {
				content: [{
					type: "text" as const,
					text: `Spawned agent "${params.name}" (pid ${proc.pid})\n` +
						`  cwd: ${agentCwd}\n` +
						`  model: ${params.model ?? "(default)"}\n` +
						`  task: ${params.task.slice(0, 100)}${params.task.length > 100 ? "…" : ""}\n\n` +
						`The agent will register in panopticon within a few seconds.\n` +
						`Use agent_peek to find it, agent_send to message it.`,
				}],
				details: {
					name: params.name,
					pid: proc.pid,
					cwd: agentCwd,
					model: params.model,
				},
			};
		},
	});

	// ── Cleanup on shutdown ─────────────────────────────────────

	pi.on("session_shutdown", async () => {
		for (const agent of spawned.values()) {
			if (!agent.done) {
				try { agent.proc.kill("SIGTERM"); } catch { /* */ }
			}
		}
	});
}
