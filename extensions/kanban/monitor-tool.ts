/**
 * Kanban monitor tool registration.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { kanbanDir, parseBoard } from "./board.js";
import {
	deliverNudge,
	formatMonitorReport,
	getInProgressTasks,
	inspectAgent,
	type MonitorCounts,
	type TaskResult,
} from "./monitor.js";

export function registerMonitorTool(pi: ExtensionAPI): void {
	// ── kanban_monitor ──────────────────────────────────────────
	pi.registerFlag("prod", { description: "kanban_monitor: deliver nudges to stalled agents", type: "boolean", default: false });

	pi.registerTool({
		name: "kanban_monitor",
		label: "Kanban Monitor",
		description:
			"Check progress on all in-progress kanban tasks. " +
			"Parses board.log directly, then inspects each agent via registry PID check and heartbeat age. " +
			"Reports ACTIVE, STALLED (stale heartbeat), BLOCKED, and MISSING states. " +
			"Agents signal completion explicitly via kanban_complete — this tool does not watch the filesystem. " +
			"With prod=true (or --prod flag) delivers a nudge to stalled agents via panopticon Maildir.",
		promptSnippet: "Check progress on all in-progress kanban tasks",
		promptGuidelines: [
			"Run kanban_monitor periodically to surface stalled or blocked agents.",
			"Use prod=true when an agent is STALLED — sends a nudge via panopticon Maildir.",
			"Agents signal completion themselves via kanban_complete — nudge them if they go quiet.",
		],
		parameters: Type.Object({
			prod: Type.Optional(Type.Boolean({ description: "Deliver a nudge to stalled agents via panopticon Maildir (default: false, or set via --prod flag)", default: false })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const isProd = params.prod ?? (pi.getFlag("--prod") as boolean | undefined) ?? false;
			const board = await parseBoard();
			const kDir = kanbanDir();
			const monitorLog = resolve(kDir, "monitor.log");
			const ts = new Date().toISOString();

			const tasks = getInProgressTasks(board);
			const results: TaskResult[] = [];
			const counts: MonitorCounts = { active: 0, stalled: 0, blocked: 0, missing: 0 };

			for (const task of tasks) {
				const inspection = inspectAgent(task.agent);
				let { status, detail } = inspection;

				if (status === "STALLED" && isProd && inspection.agentId) {
					const taskState = board.tasks.get(task.id);
					const lastNoteFull = taskState?.notes.at(-1) ?? "";
					const lastNoteMatch = lastNoteFull.match(/\] (.+)$/);
					const lastNoteText = lastNoteMatch?.[1] ?? "no notes yet";
					const lastNote = lastNoteText.length > 100 ? `${lastNoteText.slice(0, 100)}…` : lastNoteText;
					const nudge = [
						`Status update needed for ${task.id}: "${taskState?.title ?? task.id}"`,
						`Priority: ${taskState?.priority ?? "unknown"}`,
						`Last note: ${lastNote}`,
						`Please share progress via kanban_note or call kanban_block if stuck.`,
					].join("\n");
					const nudgeResult = await deliverNudge(inspection.agentId, nudge);
					detail += nudgeResult === "sent" ? " — nudge sent" : " — nudge failed";
				}

				if (status === "ACTIVE") counts.active++;
				else if (status === "STALLED") counts.stalled++;
				else if (status === "BLOCKED") counts.blocked++;
				else counts.missing++;
				results.push({ ...task, status, detail });
			}

			const report = formatMonitorReport(ts, results, counts);

			try {
				const logLines = [
					`${ts} CHECK start`,
					...results.map((r) => `${ts} ${r.id} agent=${r.agent} status=${r.status} detail=${r.detail.replace(/\n/g, " ")}`),
					`${ts} SUMMARY active=${counts.active} stalled=${counts.stalled} blocked=${counts.blocked} missing=${counts.missing}`,
				];
				await appendFile(monitorLog, `${logLines.join("\n")}\n`, "utf-8");
			} catch { /* non-fatal */ }

			return ok(report, { timestamp: ts, counts, tasks: results, prod: isProd });
		},
	});
}
