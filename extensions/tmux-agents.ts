/**
 * Tmux Agents Extension
 *
 * Shows active agents in tmux sessions at the bottom of the page.
 * Detects pi instances running in tmux panes and displays their status.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

type ContentBlock = { type: "text"; text: string };
type ToolResult = { content: ContentBlock[]; details: Record<string, unknown> };

const execAsync = promisify(exec);

interface TmuxPane {
	session: string;
	windowIndex: number;
	paneIndex: number;
	title: string;
	currentPath: string;
	pid: number;
	isAgent: boolean;
	agentType: string;
}

async function getTmuxPanes(): Promise<TmuxPane[]> {
	try {
		const { stdout } = await execAsync(
			"tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index}\t#{pane_title}\t#{pane_current_path}\t#{pane_pid}' 2>/dev/null || echo ''",
		);

		if (!stdout.trim()) {
			return [];
		}

		const panes: TmuxPane[] = [];
		const lines = stdout.trim().split("\n").filter(Boolean);

		for (const line of lines) {
			const parts = line.split("\t");
			if (parts.length >= 4) {
				const sessionPane = parts[0] ?? "";
				const match = sessionPane.match(/^([^:]+):(\d+)\.(\d+)$/);
				if (match) {
					const session = match[1] ?? "";
					const windowIndex = match[2] ?? "0";
					const paneIndex = match[3] ?? "0";
					panes.push({
						session,
						windowIndex: parseInt(windowIndex, 10),
						paneIndex: parseInt(paneIndex, 10),
						title: parts[1] ?? "",
						currentPath: parts[2] ?? "",
						pid: parseInt(parts[3] ?? "0", 10),
						isAgent: false,
						agentType: "",
					});
				}
			}
		}

		// Detect agents - check pane title for patterns
		const agentPatterns = [
			{ pattern: "π", name: "pi" },
			{ pattern: "pi", name: "pi" },
			{ pattern: "claude", name: "claude" },
			{ pattern: "aider", name: "aider" },
			{ pattern: "cursor", name: "cursor" },
			{ pattern: "gemini", name: "gemini" },
			{ pattern: "deepseek", name: "deepseek" },
		];

		for (const pane of panes) {
			const titleLower = pane.title.toLowerCase();
			for (const { pattern, name } of agentPatterns) {
				if (titleLower.includes(pattern)) {
					pane.isAgent = true;
					pane.agentType = name;
					break;
				}
			}
		}

		return panes;
	} catch {
		return [];
	}
}

function updateWidget(ctx: ExtensionContext, currentSession: string): void {
	void (async () => {
		try {
			const panes = await getTmuxPanes();
			const agents = panes.filter((p) => p.isAgent);

			if (agents.length === 0) {
				ctx.ui.setWidget("tmux-agents", undefined);
				ctx.ui.setStatus("tmux-agents", ctx.ui.theme.fg("dim", `agents: 0`));
				return;
			}

			const theme = ctx.ui.theme;
			const lines: string[] = [];

			// Group by session
			const bySession = new Map<string, TmuxPane[]>();
			for (const pane of agents) {
				const existing = bySession.get(pane.session) || [];
				existing.push(pane);
				bySession.set(pane.session, existing);
			}

			const sessionNames = [...bySession.keys()].sort();

			// Build compact display: one line per session
			for (const sessionName of sessionNames) {
				const sessionAgents = bySession.get(sessionName) || [];
				const isCurrentSession = sessionName === currentSession;

				// Session marker
				const marker = isCurrentSession
					? theme.fg("accent", "●")
					: theme.fg("dim", "○");

				// Agents left to right: pane:agent:repo
				const agentStrs = sessionAgents.map((agent) => {
					const pathParts = agent.currentPath.split("/");
					const repo = pathParts[pathParts.length - 1] || agent.currentPath;
					const paneId = `${sessionName}:${agent.windowIndex}.${agent.paneIndex}`;
					return `${theme.fg("dim", paneId)} ${theme.fg("success", agent.agentType)}:${theme.fg("muted", repo)}`;
				});

				lines.push(`${marker} ${agentStrs.join("  ")}`);
			}

			ctx.ui.setWidget("tmux-agents", lines, { placement: "belowEditor" });
			ctx.ui.setStatus("tmux-agents", ctx.ui.theme.fg("accent", `${agents.length} agents`));
		} catch {
			ctx.ui.setStatus("tmux-agents", ctx.ui.theme.fg("error", "agents: err"));
		}
	})();
}

export default function (pi: ExtensionAPI) {
	let currentSession = "";
	let refreshInterval: ReturnType<typeof setInterval> | null = null;


	// ── agent_peek tool ─────────────────────────────────────────────
	pi.registerTool({
		name: "agent_peek",
		label: "Agent Peek",
		description:
			"List agents discovered in tmux sessions, or read the current visible output of a specific agent pane. " +
			"With no target: returns all discovered agents. With a target (session:window.pane): captures the pane content.",
		promptSnippet: "Discover agents in tmux or read a specific agent pane's visible output",
		parameters: Type.Object({
			target: Type.Optional(
				Type.String({
					description:
						"Tmux pane address (session:window.pane, e.g. 0:1.0). Omit to list all agents.",
				}),
			),
			lines: Type.Optional(
				Type.Number({
					description: "Number of lines to capture from the pane (default 50)",
					default: 50,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			if (!params.target) {
				// List mode
				const panes = await getTmuxPanes();
				const agents = panes.filter((p) => p.isAgent);

				if (agents.length === 0) {
					return {
						content: [{ type: "text", text: "No agents discovered in tmux sessions." }],
						details: { agents: [] },
					};
				}

				const listing = agents.map((a) => {
					const paneId = `${a.session}:${a.windowIndex}.${a.paneIndex}`;
					const pathParts = a.currentPath.split("/");
					const repo = pathParts[pathParts.length - 1] ?? a.currentPath;
					return `  ${paneId}  ${a.agentType}  cwd=${repo}  pid=${a.pid}`;
				});

				return {
					content: [
						{
							type: "text",
							text: `Found ${agents.length} agent(s):\n${listing.join("\n")}\n\nUse agent_peek with a target to read pane output, or agent_send to message an agent.`,
						},
					],
					details: { agents: agents.map((a) => ({ id: `${a.session}:${a.windowIndex}.${a.paneIndex}`, type: a.agentType, cwd: a.currentPath })) },
				};
			}

			// Capture mode
			const target = params.target.replace(/^@/, "");
			const lineCount = params.lines ?? 50;

			try {
				const { stdout } = await execAsync(
					`tmux capture-pane -t ${target} -p -S -${lineCount} 2>/dev/null`,
				);
				const trimmed = stdout.trimEnd();
				if (!trimmed) {
					return {
						content: [{ type: "text", text: `Pane ${target} is empty or not found.` }],
						details: { target, lines: 0 },
					};
				}
				return {
					content: [{ type: "text", text: `Pane ${target} (last ${lineCount} lines):\n\n${trimmed}` }],
					details: { target, lines: trimmed.split("\n").length },
				};
			} catch (err) {
				throw new Error(`Failed to capture pane ${target}: ${err}`);
			}
		},
	});

	// ── spawn_agent tool ────────────────────────────────────────────
	pi.registerTool({
		name: "spawn_agent",
		label: "Spawn Agent",
		description:
			"Spawn a new pi agent in a tmux pane (vertical split). " +
			"Creates the working directory, writes a BRIEF.md with mission instructions, " +
			"copies the parent directory's AGENTS.md if present, and launches pi.",
		promptSnippet: "Spawn a new pi coding agent in its own tmux pane",
		promptGuidelines: [
			"Give each agent a clear, self-contained brief so it can work autonomously.",
			"Use agent_peek after spawning to confirm the agent started.",
		],
		parameters: Type.Object({
			name: Type.String({
				description: 'Short name for the worker (e.g. "api-builder")',
			}),
			path: Type.String({
				description: "Directory where the worker operates (created if missing)",
			}),
			brief: Type.String({
				description: "Full mission instructions — written to path/BRIEF.md",
			}),
			model: Type.Optional(
				Type.String({
					description: 'Model passed to `pi --model <value>`. Accepts any model string (e.g. "claude-sonnet-4-6", "ollama/glm-5:cloud", "google-gemini-cli/gemini-2.5-pro"). Default: "claude-sonnet-4-6".',
					default: "claude-sonnet-4-6",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal) {
			const name = params.name;
			const agentPath = resolve(params.path);
			const brief = params.brief;
			const model = params.model ?? "claude-sonnet-4-6";

			// Validate model against available models
			try {
				const { stdout: modelsOutput } = await execAsync("pi --list-models 2>&1");
				if (!modelsOutput.includes(model)) {
					throw new Error(
						`Model '${model}' not found. Run \`pi --list-models\` to see available models.`,
					);
				}
			} catch (err) {
				// Re-throw our own validation errors
				if (err instanceof Error && err.message.includes("not found")) {
					throw err;
				}
				// If pi --list-models itself fails, warn but proceed
			}

			// 1. Create working directory
			await mkdir(agentPath, { recursive: true });

			// 2. Write BRIEF.md
			await writeFile(join(agentPath, "BRIEF.md"), brief, "utf-8");

			// 3. Copy parent AGENTS.md if it exists
			const parentAgentsMd = join(dirname(agentPath), "AGENTS.md");
			if (existsSync(parentAgentsMd)) {
				await copyFile(parentAgentsMd, join(agentPath, "AGENTS.md"));
			}

			// 4. Launch pi in a new tmux pane
			const { stdout: newPane } = await execAsync(
				`tmux split-window -v -c ${JSON.stringify(agentPath)} -P -F '#{session_name}:#{window_index}.#{pane_index}' "pi --model ${model}"`,
			);
			const paneAddress = newPane.trim();

			return {
				content: [
					{
						type: "text",
						text: `Spawned agent "${name}" (model=${model})\n  pane: ${paneAddress}\n  path: ${agentPath}\n  brief: ${brief.length} chars written to BRIEF.md\n\nUse agent_peek with target "${paneAddress}" to check status.`,
					},
				],
				details: { name, pane: paneAddress, path: agentPath, model },
			};
		},
	});

	// ── agent_send tool ─────────────────────────────────────────────
	pi.registerTool({
		name: "agent_send",
		label: "Agent Send",
		description:
			"Send a message to another agent running in a tmux pane. " +
			"The message is typed into the target pane and Enter is pressed. " +
			"Use agent_peek first to discover agents and their pane addresses. " +
			"After sending, use agent_peek with the same target to read the response.",
		promptSnippet: "Send a message to another agent in a tmux pane",
		promptGuidelines: [
			"Use agent_peek first (no target) to discover available agents before sending.",
			"After agent_send, wait a few seconds then agent_peek the same target to read the reply.",
			"Do not send to your own pane.",
		],
		parameters: Type.Object({
			target: Type.String({
				description: "Tmux pane address (session:window.pane, e.g. 0:1.0)",
			}),
			message: Type.String({
				description: "Message to send to the agent",
			}),
		}),

		async execute(_toolCallId, params, _signal) {
			const target = params.target.replace(/^@/, "");
			const message = params.message;

			// Validate target format
			if (!/^[\w-]+:\d+\.\d+$/.test(target)) {
				throw new Error(
					`Invalid target format: "${target}". Expected session:window.pane (e.g. 0:1.0)`,
				);
			}

			try {
				// Escape single quotes for shell safety
				const escaped = message.replace(/'/g, "'\\''");
				await execAsync(`tmux send-keys -t ${target} '${escaped}' Enter`);

				return {
					content: [
						{
							type: "text",
							text: `Sent to ${target}: ${message.slice(0, 200)}${message.length > 200 ? "..." : ""}\n\nUse agent_peek with target "${target}" to read the response.`,
						},
					],
					details: { target, messageLength: message.length },
				};
			} catch (err) {
				throw new Error(`Failed to send to ${target}: ${err}`);
			}
		},
	});

	async function getCurrentSession(): Promise<string> {
		try {
			const { stdout } = await execAsync('tmux display-message -p "#{session_name}" 2>/dev/null || echo ""');
			return stdout.trim();
		} catch {
			return "";
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		currentSession = await getCurrentSession();
		updateWidget(ctx, currentSession);

		refreshInterval = setInterval(() => {
			void getCurrentSession().then((s) => {
				currentSession = s;
				updateWidget(ctx, currentSession);
			});
		}, 5000);
	});

	pi.on("session_shutdown", () => {
		if (refreshInterval) {
			clearInterval(refreshInterval);
			refreshInterval = null;
		}
	});

	pi.on("session_switch", async () => {
		currentSession = await getCurrentSession();
	});

	pi.registerCommand("tmux-agents", {
		description: "Show active agents in tmux sessions",
		handler: async (_args, ctx) => {
			const panes = await getTmuxPanes();
			const agents = panes.filter((p) => p.isAgent);
			const sessions = new Set(agents.map((a) => a.session)).size;
			ctx.ui.notify(`${agents.length} agent(s) in ${sessions} session(s)`, "info");
		},
	});

	// Send message to another tmux pane
	pi.registerCommand("send", {
		description: "Send a message to another agent. Usage: /send <session:window.pane> <message>",
		getArgumentCompletions: (_prefix: string) => {
			return null;
		},
		handler: async (args, ctx) => {
			if (!args) {
				ctx.ui.notify("Usage: /send <session:window.pane> <message>", "warning");
				return;
			}

			// Parse: <target> <message>
			const match = args.match(/^(\S+)\s+(.+)$/s);
			if (!match) {
				ctx.ui.notify("Usage: /send <session:window.pane> <message>", "warning");
				return;
			}

			const target = match[1];
			const message = match[2];
			if (!target || !message) {
				ctx.ui.notify("Usage: /send <session:window.pane> <message>", "warning");
				return;
			}

			// Validate target format
			const targetMatch = target.match(/^(\d+):(\d+)\.(\d+)$/);
			if (!targetMatch) {
				ctx.ui.notify("Invalid target. Use format: session:window.pane (e.g., 1:0.0)", "warning");
				return;
			}

			try {
				// Send the message to the target pane
				await execAsync(`tmux send-keys -t ${target} '${message.replace(/'/g, "'\\''") }' Enter`);
				ctx.ui.notify(`Sent to ${target}: ${message.slice(0, 50)}${message.length > 50 ? "..." : ""}`, "info");
			} catch (err) {
				ctx.ui.notify(`Failed to send: ${err}`, "error");
			}
		},
	});

	// Commit and push current work
	pi.registerCommand("commit-and-push", {
		description: "Commit and push. Usage: /commit-and-push [optional message or instructions]",
		handler: async (args, ctx) => {
			try {
				// Check for changes
				const { stdout: status } = await execAsync("git status --short");
				if (!status.trim()) {
					ctx.ui.notify("Nothing to commit — working tree clean.", "info");
					return;
				}

				// Stage all changes
				await execAsync("git add -A");

				// Build commit message
				const message = args?.trim()
					? args.trim()
					: "chore: commit current work";

				// Commit
				const escaped = message.replace(/"/g, '\\"');
				await execAsync(`git commit -m "${escaped}"`);

				// Push
				await execAsync("git push");

				const fileCount = status.trim().split("\n").length;
				ctx.ui.notify(`Pushed ${fileCount} file(s): ${message.slice(0, 60)}`, "info");
			} catch (err) {
				ctx.ui.notify(`commit-and-push failed: ${err}`, "error");
			}
		},
	});
}