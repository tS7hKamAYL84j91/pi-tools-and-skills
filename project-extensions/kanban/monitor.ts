/**
 * Kanban monitor — agent health inspection and nudge delivery.
 *
 * Uses lib/agent-api for agent lookups and messaging rather than
 * reaching into registry internals or transport implementations.
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { findAgentByName, sendAgentMessage } from "../../lib/agent-api.js";
import { type BoardState, kanbanDir } from "./board.js";

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
	// Default sibling-of-kanban layout: <kanbanDir>/../research/<agent>/REPORT.md
	const researchBase = process.env.KANBAN_REPORT_BASE ?? join(dirname(kanbanDir()), "research");
	const exactReport = join(researchBase, agentName, "REPORT.md");
	if (existsSync(exactReport)) return true;
	try {
		const { stdout } = await execAsync(
			`find ${JSON.stringify(researchBase)} -maxdepth 2 -name REPORT.md -path "*${agentName}*" 2>/dev/null | head -1`,
		);
		return stdout.trim().length > 0;
	} catch { return false; }
}

/** Inspect an agent's liveness via the agent API. */
export function inspectAgent(agentName: string): AgentInspection {
	const info = findAgentByName(agentName);
	if (!info) return { status: "MISSING", detail: `no registered agent for '${agentName}'` };
	if (!info.alive) return { status: "MISSING", detail: `agent PID ${info.pid} not running`, agentId: info.id };
	if (info.heartbeatAge > 300_000) {
		return { status: "STALLED", detail: `heartbeat ${Math.round(info.heartbeatAge / 60_000)}m ago`, agentId: info.id };
	}
	return { status: "ACTIVE", detail: "(running)", agentId: info.id };
}

/** Deliver a nudge to an agent via the agent API. */
export async function deliverNudge(agentId: string, nudge: string): Promise<"sent" | "failed"> {
	const accepted = await sendAgentMessage(agentId, "kanban-monitor", nudge);
	return accepted ? "sent" : "failed";
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
