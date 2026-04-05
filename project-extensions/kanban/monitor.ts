/**
 * Kanban monitor — agent health inspection and nudge delivery.
 *
 * Inspects agents via the panopticon registry (PID liveness +
 * heartbeat age) and checks for REPORT.md completion markers.
 * Formats monitor reports and delivers nudges via Maildir.
 */

import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BoardState } from "./board.js";

const execAsync = promisify(exec);

// ── Types ───────────────────────────────────────────────────────

export type MonitorStatus = "ACTIVE" | "STALLED" | "BLOCKED" | "DONE" | "MISSING";

interface TaskRow { id: string; agent: string; title: string }
export interface TaskResult { id: string; agent: string; status: MonitorStatus; detail: string }
export interface MonitorCounts { active: number; stalled: number; blocked: number; done: number; missing: number }

interface AgentInspection { status: MonitorStatus; detail: string; agentId?: string }

// ── Agent inspection ────────────────────────────────────────────

/** Extract in-progress tasks from a parsed board. */
export function getInProgressTasks(board: BoardState): TaskRow[] {
	const tasks: TaskRow[] = [];
	for (const tid of board.order) {
		const t = board.tasks.get(tid);
		if (t && t.col === "in-progress") {
			tasks.push({ id: t.id, agent: t.claimAgent || t.agent, title: t.title });
		}
	}
	return tasks;
}

/** Check if REPORT.md exists for a given agent. */
export async function checkReportDone(agentName: string): Promise<boolean> {
	const researchBase = process.env.KANBAN_REPORT_BASE ?? join(homedir(), "git", "working-notes", "research");
	const exactReport = join(researchBase, agentName, "REPORT.md");
	if (existsSync(exactReport)) return true;
	try {
		const { stdout } = await execAsync(
			`find ${JSON.stringify(researchBase)} -maxdepth 2 -name REPORT.md -path "*${agentName}*" 2>/dev/null | head -1`,
		);
		return stdout.trim().length > 0;
	} catch { return false; }
}

/** Read registry JSON, check PID liveness and heartbeat age. */
export function inspectAgent(agentName: string): AgentInspection {
	const agentsDir = join(homedir(), ".pi", "agents");
	try {
		if (!existsSync(agentsDir)) return { status: "MISSING", detail: "agents dir not found" };
		for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".json"))) {
			try {
				const rec = JSON.parse(readFileSync(join(agentsDir, f), "utf-8"));
				if (rec.name?.toLowerCase() !== agentName.toLowerCase()) continue;
				const agentId = rec.id as string | undefined;
				let pidAlive = false;
				if (rec.pid) {
					try { process.kill(rec.pid, 0); pidAlive = true; } catch { /* not running */ }
				}
				if (!pidAlive) return { status: "MISSING", detail: `agent PID ${rec.pid ?? "?"} not running`, agentId };
				if (rec.heartbeat) {
					const ageMs = Date.now() - new Date(rec.heartbeat).getTime();
					if (ageMs > 300_000) return { status: "STALLED", detail: `heartbeat ${Math.round(ageMs / 60_000)}m ago`, agentId };
				}
				return { status: "ACTIVE", detail: "(running)", agentId };
			} catch { /* skip corrupt */ }
		}
	} catch { /* ignore */ }
	return { status: "MISSING", detail: `no registered agent for '${agentName}'` };
}

/** Deliver a nudge to an agent's Maildir. */
export async function deliverNudge(agentId: string, nudge: string): Promise<"sent" | "failed"> {
	try {
		const msgFile = join(homedir(), ".pi", "agents", agentId, `${Date.now()}-kanban.json`);
		await writeFile(msgFile, JSON.stringify({ type: "cast", from: "kanban-monitor", text: nudge }), "utf-8");
		return "sent";
	} catch { return "failed"; }
}

/** Format a monitor report from results and counts. */
export function formatMonitorReport(ts: string, results: TaskResult[], counts: MonitorCounts): string {
	const lines: string[] = [`=== Progress Check [${ts}] ===`];
	if (results.length === 0) {
		lines.push("  (no in-progress tasks)");
	} else {
		for (const r of results) {
			lines.push(`  ${r.id} (${r.agent}): ${r.status} — ${r.detail}`);
		}
	}
	lines.push("---");
	lines.push(
		`  Running: ${counts.active} | Stalled: ${counts.stalled} | ` +
		`Blocked: ${counts.blocked} | Done: ${counts.done} | Missing: ${counts.missing}`,
	);
	return lines.join("\n");
}
