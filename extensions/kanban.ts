/**
 * Kanban Extension
 *
 * Wraps the CoAS kanban shell scripts as pi tools.
 * Scripts are resolved via KANBAN_SCRIPTS_DIR env var, falling back to
 * common locations (~/git/coas/kanban/scripts, ./kanban/scripts).
 *
 * Tools:
 *   kanban_create   — create a new task in the backlog
 *   kanban_pick     — claim the next highest-priority todo task
 *   kanban_complete — mark a task done
 *   kanban_block    — mark a task blocked
 *   kanban_note     — append a progress note to a task
 *   kanban_snapshot — regenerate and read snapshot.md
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type ContentBlock = { type: "text"; text: string };
type ToolResult = { content: ContentBlock[]; details: Record<string, unknown> };

// ── Script resolution ─────────────────────────────────────────────────────

function findScriptsDir(): string | null {
	// 1. Explicit env var
	const env = process.env["KANBAN_SCRIPTS_DIR"];
	if (env && existsSync(env)) return env;

	// 2. ~/git/coas/kanban/scripts
	const home = join(homedir(), "git", "coas", "kanban", "scripts");
	if (existsSync(home)) return home;

	// 3. ./kanban/scripts relative to CWD
	const cwd = join(process.cwd(), "kanban", "scripts");
	if (existsSync(cwd)) return cwd;

	return null;
}

function scriptsDir(): string {
	const dir = findScriptsDir();
	if (!dir) {
		throw new Error(
			"Kanban scripts not found. Set KANBAN_SCRIPTS_DIR or run from the coas project root.",
		);
	}
	return dir;
}

async function runScript(scriptName: string, args: string[]): Promise<string> {
	const dir = scriptsDir();
	const script = join(dir, scriptName);

	if (!existsSync(script)) {
		throw new Error(`Script not found: ${script}`);
	}

	// Shell-quote each argument: wrap in single quotes, escape internal single quotes
	const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
	const cmd = `bash ${JSON.stringify(script)} ${quoted}`;

	const { stdout, stderr } = await execAsync(cmd);
	const out = stdout.trim();
	const err = stderr.trim();
	return err ? `${out}\n[stderr] ${err}`.trim() : out;
}

// ── Extension export ──────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── kanban_create ───────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_create",
		label: "Kanban Create",
		description:
			"Create a new task in the kanban backlog. " +
			"The task starts in the backlog column. Use kanban_snapshot to view the board afterwards.",
		promptSnippet: "Create a new kanban task in the backlog",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format (e.g., T-011). Must be unique.',
			}),
			agent: Type.String({
				description: 'Agent name creating the task (lowercase, hyphens only, e.g. "lead")',
			}),
			title: Type.String({
				description: 'Human-readable task title',
			}),
			priority: Type.String({
				description: 'Task priority: critical | high | medium | low',
				enum: ["critical", "high", "medium", "low"],
			}),
			tags: Type.Optional(
				Type.String({
					description: 'Optional comma-separated tags (e.g. "tools,research")',
					default: "",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const args = [params.task_id, params.agent, params.title, params.priority];
			if (params.tags) args.push(params.tags);

			const output = await runScript("kanban-create.sh", args);

			return {
				content: [{ type: "text", text: output }],
				details: {
					task_id: params.task_id,
					title: params.title,
					priority: params.priority,
					tags: params.tags ?? "",
				},
			};
		},
	});

	// ── kanban_pick ─────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_pick",
		label: "Kanban Pick",
		description:
			"Claim the next highest-priority todo task for an agent. " +
			"Returns the claimed task ID, NO_TASK_AVAILABLE if nothing is ready, or " +
			"WIP_LIMIT_REACHED if the 3-task in-progress cap is hit. " +
			"Call kanban_snapshot afterwards to see your task details.",
		promptSnippet: "Claim the next kanban task for an agent",
		parameters: Type.Object({
			agent: Type.String({
				description: 'Agent name claiming the task (lowercase, hyphens only, e.g. "tools-worker")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const output = await runScript("kanban-pick.sh", [params.agent]);

			const taskId = output.split("\n")[0]?.trim() ?? "";
			const claimed =
				taskId !== "NO_TASK_AVAILABLE" && !taskId.startsWith("WIP_LIMIT");

			return {
				content: [
					{
						type: "text",
						text: claimed
							? `Claimed ${taskId} for agent "${params.agent}".\nRun kanban_snapshot to see full task details.`
							: output,
					},
				],
				details: { agent: params.agent, result: taskId, claimed },
			};
		},
	});

	// ── kanban_complete ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_complete",
		label: "Kanban Complete",
		description:
			"Mark an in-progress task as done. " +
			"Optionally provide how long the task took (e.g. '45m', '2h').",
		promptSnippet: "Mark a kanban task as completed",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name that completed the task (must match the claiming agent)',
			}),
			duration: Type.Optional(
				Type.String({
					description: 'Optional duration string (e.g. "45m", "2h", "107m")',
					default: "unknown",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const args = [params.task_id, params.agent];
			if (params.duration) args.push(params.duration);

			const output = await runScript("kanban-complete.sh", args);

			return {
				content: [{ type: "text", text: output }],
				details: {
					task_id: params.task_id,
					agent: params.agent,
					duration: params.duration ?? "unknown",
				},
			};
		},
	});

	// ── kanban_block ────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_block",
		label: "Kanban Block",
		description:
			"Mark an in-progress task as blocked. " +
			"Frees the WIP slot and records the reason. " +
			"The orchestrator will see this and can unblock by resolving the dependency.",
		promptSnippet: "Mark a kanban task as blocked with a reason",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name that is blocked',
			}),
			reason: Type.String({
				description: 'Short description of what is needed to unblock (e.g. "waiting for API key from orchestrator")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const output = await runScript("kanban-block.sh", [
				params.task_id,
				params.agent,
				params.reason,
			]);

			return {
				content: [{ type: "text", text: output }],
				details: {
					task_id: params.task_id,
					agent: params.agent,
					reason: params.reason,
				},
			};
		},
	});

	// ── kanban_note ─────────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_note",
		label: "Kanban Note",
		description:
			"Append a timestamped progress note to a task. " +
			"Use for milestones, status updates, and observations. " +
			"Notes appear in the snapshot under the task.",
		promptSnippet: "Add a progress note to a kanban task",
		parameters: Type.Object({
			task_id: Type.String({
				description: 'Task ID in T-NNN format',
			}),
			agent: Type.String({
				description: 'Agent name adding the note',
			}),
			text: Type.String({
				description: 'Note text (e.g. "core logic done, writing tests")',
			}),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			const output = await runScript("kanban-note.sh", [
				params.task_id,
				params.agent,
				params.text,
			]);

			return {
				content: [{ type: "text", text: output }],
				details: {
					task_id: params.task_id,
					agent: params.agent,
					text: params.text,
				},
			};
		},
	});

	// ── kanban_snapshot ─────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_snapshot",
		label: "Kanban Snapshot",
		description:
			"Regenerate snapshot.md from board.log and return the full board view. " +
			"Shows all columns: Backlog, Todo, In Progress, Blocked, and Done (last 10). " +
			"Always run this before presenting board status to a human.",
		promptSnippet: "Regenerate and read the kanban board snapshot",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal): Promise<ToolResult> {
			// Run the snapshot script (writes snapshot.md)
			const scriptOutput = await runScript("kanban-snapshot.sh", []);

			// Read the generated snapshot.md
			const dir = scriptsDir();
			// scripts live in kanban/scripts/, snapshot.md is in kanban/
			const snapshotPath = resolve(dir, "..", "snapshot.md");

			let snapshot = "";
			try {
				snapshot = await readFile(snapshotPath, "utf-8");
			} catch {
				snapshot = `(Could not read snapshot.md at ${snapshotPath})`;
			}

			return {
				content: [
					{
						type: "text",
						text: `${scriptOutput}\n\n---\n\n${snapshot}`,
					},
				],
				details: { snapshotPath, scriptOutput },
			};
		},
	});
}
