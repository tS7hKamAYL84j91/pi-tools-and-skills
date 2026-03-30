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
 *   kanban_monitor  — check progress on all in-progress tasks
 *
 * Flags:
 *   --prod          — kanban_monitor sends a status nudge to stalled agents
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execAsync = promisify(exec);

type ContentBlock = { type: "text"; text: string };
type ToolResult = { content: ContentBlock[]; details: Record<string, unknown> };

// ── Monitor: stall-detection state ──────────────────────────────────────────
// State files live in /tmp/kanban-monitor-state/{tid}.{hash|stall}
// hash  — md5 of last captured pane content
// stall — integer count of consecutive unchanged cycles

const MONITOR_STATE_DIR = "/tmp/kanban-monitor-state";
const MONITOR_STALL_DEFAULT = 3;

async function monitorStateRead(file: string, fallback: string): Promise<string> {
	try { return (await readFile(file, "utf-8")).trim(); } catch { return fallback; }
}
async function monitorStateWrite(file: string, value: string): Promise<void> {
	await mkdir(MONITOR_STATE_DIR, { recursive: true });
	await writeFile(file, value, "utf-8");
}
function md5(s: string): string {
	return createHash("md5").update(s).digest("hex");
}
async function getStallCount(tid: string): Promise<number> {
	return parseInt(await monitorStateRead(`${MONITOR_STATE_DIR}/${tid}.stall`, "0"), 10) || 0;
}
async function setStallCount(tid: string, n: number): Promise<void> {
	await monitorStateWrite(`${MONITOR_STATE_DIR}/${tid}.stall`, String(n));
}
async function getLastHash(tid: string): Promise<string> {
	return monitorStateRead(`${MONITOR_STATE_DIR}/${tid}.hash`, "");
}
async function saveHash(tid: string, hash: string): Promise<void> {
	await monitorStateWrite(`${MONITOR_STATE_DIR}/${tid}.hash`, hash);
}

// ── Script resolution ─────────────────────────────────────────────────────

function findScriptsDir(): string | null {
	// 1. Explicit env var
	const env = process.env.KANBAN_SCRIPTS_DIR;
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

	// ── kanban_monitor ──────────────────────────────────────────────
	pi.registerFlag("prod", {
		description: "kanban_monitor: send a status nudge to stalled agents via agent_send",
		type: "boolean",
		default: false,
	});

	pi.registerTool({
		name: "kanban_monitor",
		label: "Kanban Monitor",
		description:
			"Check progress on all in-progress kanban tasks. " +
			"Calls kanban_snapshot, then uses agent_peek to inspect each agent's tmux pane. " +
			"Detects ACTIVE, STALLED (no pane change for N cycles), BLOCKED, DONE (REPORT.md), " +
			"and MISSING states. With prod=true (or --prod flag) sends a status nudge to stalled agents.",
		promptSnippet: "Check progress on all in-progress kanban tasks",
		promptGuidelines: [
			"Run kanban_monitor periodically to surface stalled or blocked agents.",
			"Use prod=true only after an agent has been STALLED for multiple cycles — trust but verify.",
			"When kanban_monitor reports DONE (REPORT.md found), call kanban_complete to close the task.",
		],
		parameters: Type.Object({
			prod: Type.Optional(Type.Boolean({
				description: "Send a nudge message to stalled agents (default: false, or set via --prod flag)",
				default: false,
			})),
			stall_cycles: Type.Optional(Type.Number({
				description: "Consecutive unchanged pane-captures before declaring STALLED (default: 3)",
				default: 3,
			})),
			verbose: Type.Optional(Type.Boolean({
				description: "Include raw last-line of pane output for ACTIVE tasks (default: false)",
				default: false,
			})),
		}),

		async execute(_toolCallId, params, _signal): Promise<ToolResult> {
			// --prod flag (CLI) can override the parameter default
			const isProd = params.prod ?? (pi.getFlag("--prod") as boolean | undefined) ?? false;
			const stallThreshold = params.stall_cycles ?? MONITOR_STALL_DEFAULT;
			const verbose = params.verbose ?? false;

			// ── 1. Refresh snapshot & locate files ───────────────────
			const sDir = scriptsDir();
			await runScript("kanban-snapshot.sh", []);
			const snapshotPath = resolve(sDir, "..", "snapshot.md");
			const monitorLog = resolve(sDir, "..", "monitor.log");
			const commFile = resolve(sDir, "..", "..", "COMMUNICATION.md");

			const snapshot = await readFile(snapshotPath, "utf-8");
			const ts = new Date().toISOString();

			// ── 2. Parse in-progress tasks from snapshot ─────────────
			// Table row format under "## 🔄 In Progress":
			//   | T-NNN | Title | agent | Expires |
			type TaskRow = { id: string; agent: string; title: string };
			const tasks: TaskRow[] = [];
			let inSection = false;
			for (const line of snapshot.split("\n")) {
				if (/^## .* In Progress/.test(line)) { inSection = true; continue; }
				if (/^## /.test(line)) { inSection = false; continue; }
				if (!inSection) continue;
				if (!/^\| T-/.test(line)) continue;
				const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
				// cols: [id, title, agent, expires]
				const colId = cols[0] ?? "";
				if (cols.length >= 3 && /^T-\d+$/.test(colId)) {
					tasks.push({ id: colId, title: cols[1] ?? "", agent: cols[2] ?? "unknown" });
				}
			}

			// ── 3. Check each task ───────────────────────────────────
			type Status = "ACTIVE" | "STALLED" | "BLOCKED" | "DONE" | "MISSING";
			type TaskResult = { id: string; agent: string; status: Status; detail: string };
			const results: TaskResult[] = [];
			const counts = { active: 0, stalled: 0, blocked: 0, done: 0, missing: 0 };

			for (const task of tasks) {
				let status: Status = "ACTIVE";
				let detail = "";

				// 3a. DONE? — REPORT.md in common research paths
				const researchBase = join(homedir(), "git", "working-notes", "research");
				const exactReport = join(researchBase, task.agent, "REPORT.md");
				let hasDone = existsSync(exactReport);
				if (!hasDone) {
					try {
						const { stdout: found } = await execAsync(
							`find ${JSON.stringify(researchBase)} -maxdepth 2 -name REPORT.md -path "*${task.agent}*" 2>/dev/null | head -1`,
						);
						hasDone = found.trim().length > 0;
					} catch { /* ignore */ }
				}
				if (hasDone) {
					status = "DONE"; detail = "REPORT.md found";
					counts.done++;
					await setStallCount(task.id, 0);
					results.push({ ...task, status, detail });
					continue;
				}

				// 3b. Find pane — convention: pi:{agent} session or pi_{agent}
				let pane = "";
				for (const sessionName of [`pi:${task.agent}`, `pi_${task.agent}`]) {
					try {
						await execAsync(`tmux has-session -t ${JSON.stringify(sessionName)} 2>/dev/null`);
						pane = `${sessionName}:0.0`;
						break;
					} catch { /* not found */ }
				}
				// Fallback: fuzzy match across all windows
				if (!pane) {
					try {
						const { stdout: wins } = await execAsync(
							"tmux list-windows -a -F '#{session_name}:#{window_index}.#{pane_index} #{session_name}' 2>/dev/null || true",
						);
						for (const wline of wins.split("\n")) {
							const [pid, sname] = wline.split(" ");
							if (pid && sname?.toLowerCase().includes(task.agent.toLowerCase())) {
								pane = pid; break;
							}
						}
					} catch { /* ignore */ }
				}

				if (!pane) {
					status = "MISSING"; detail = `no tmux pane found for agent '${task.agent}'`;
					counts.missing++;
					results.push({ ...task, status, detail });
					continue;
				}

				// 3c. Peek pane (strip ANSI)
				let paneContent = "";
				try {
					const { stdout: raw } = await execAsync(
						`tmux capture-pane -p -t ${JSON.stringify(pane)} 2>/dev/null | tail -15`,
					);
					// Strip ANSI escape sequences (ESC = \u001b)
					const esc = "\u001b";
					paneContent = raw
						.replace(new RegExp(`${esc}\\[[0-9;]*[mGKHFJ]`, "g"), "")
						.replace(new RegExp(`${esc}[()][AB012]`, "g"), "");
				} catch { /* pane vanished */ }

				const lastLine = paneContent.split("\n").filter((l) => l.trim()).at(-1)?.trim().slice(0, 80) ?? "";

				// 3d. BLOCKED?
				if (paneContent.includes("BLOCKED:")) {
					const bLine = paneContent.split("\n").find((l) => l.includes("BLOCKED:"))
						?.replace(/.*BLOCKED:/, "BLOCKED:").slice(0, 80) ?? "BLOCKED: (see pane)";
					status = "BLOCKED"; detail = bLine;
					counts.blocked++;
					await setStallCount(task.id, 0);
					results.push({ ...task, status, detail });
					continue;
				}

				// 3e. Stall detection
				const curHash = md5(paneContent);
				const lastHash = await getLastHash(task.id);
				let stallCount = await getStallCount(task.id);

				if (curHash === lastHash && lastHash !== "") {
					stallCount++;
					await setStallCount(task.id, stallCount);
					if (stallCount >= stallThreshold) {
						status = "STALLED";
						detail = `no pane change for ${stallCount} cycle(s)`;
						counts.stalled++;
						// --prod: nudge the agent via agent_send (tmux send-keys)
						if (isProd) {
							const nudge = `Status update? ${task.id} appears stalled. Please share progress or call kanban_block if stuck.`;
							try {
								const escaped = nudge.replace(/'/g, "'\\''" );
								await execAsync(`tmux send-keys -t ${JSON.stringify(pane)} '${escaped}' Enter`);
								detail += " — nudge sent";
							} catch {
								detail += " — nudge failed";
							}
						}
					} else {
						status = "ACTIVE";
						detail = `unchanged ${stallCount}/${stallThreshold} cycles`;
						if (verbose) detail += ` — ${lastLine}`;
						counts.active++;
					}
				} else {
					await saveHash(task.id, curHash);
					await setStallCount(task.id, 0);
					status = "ACTIVE";
					detail = verbose ? lastLine || "(running)" : "(running)";
					counts.active++;
				}

				results.push({ ...task, status, detail });
			}

			// ── 4. Format report ────────────────────────────────────
			const reportLines: string[] = [`=== Progress Check [${ts}] ===`];
			if (results.length === 0) {
				reportLines.push("  (no in-progress tasks)");
			} else {
				for (const r of results) {
					reportLines.push(`  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`);
				}
			}
			reportLines.push("---");
			reportLines.push(
				`  Running: ${counts.active} | Stalled: ${counts.stalled} | ` +
				`Blocked: ${counts.blocked} | Done: ${counts.done} | Missing: ${counts.missing}`,
			);
			const report = reportLines.join("\n");

			// ── 5. Append to monitor.log ─────────────────────────────
			try {
				const logLines = [`${ts} CHECK start`];
				for (const r of results) {
					logLines.push(`${ts} ${r.id} agent=${r.agent} status=${r.status} detail=${r.detail.replace(/\n/g, " ")}`);
				}
				logLines.push(
					`${ts} SUMMARY active=${counts.active} stalled=${counts.stalled} ` +
					`blocked=${counts.blocked} done=${counts.done} missing=${counts.missing}`,
				);
				await appendFile(monitorLog, `${logLines.join("\n")}\n`, "utf-8");
			} catch { /* log failures are non-fatal */ }

			// ── 6. Alert COMMUNICATION.md if issues detected ─────────
			if (counts.stalled > 0 || counts.blocked > 0) {
				try {
					const issues = results.filter((r) => r.status === "STALLED" || r.status === "BLOCKED");
					const alertLines = [
						`[TO: lead] [FROM: kanban-monitor] ${ts} — ${counts.blocked} blocked, ${counts.stalled} stalled`,
						...issues.map((r) => `  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`),
						"",
					];
					await appendFile(commFile, alertLines.join("\n"), "utf-8");
				} catch { /* non-fatal */ }
			}

			return {
				content: [{ type: "text", text: report }],
				details: {
					timestamp: ts,
					counts,
					tasks: results,
					prod: isProd,
					stallThreshold,
				},
			};
		},
	});
}
