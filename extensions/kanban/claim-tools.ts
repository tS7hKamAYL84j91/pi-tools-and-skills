/**
 * Kanban claim and assignment tool registrations.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { TASK_ID_SCHEMA } from "./schemas.js";
import {
	PRIORITY_ORDER,
	WIP_LIMIT,
	logAppend,
	nowZ,
	parseBoard,
	sanitiseAgent,
	validateTaskId,
} from "./board.js";

export function registerClaimTools(pi: ExtensionAPI): void {
	// ── Unified Assignment Logic ────────────────────────────────

	async function performClaim(agent: string, targetTaskId?: string, model?: string): Promise<ToolResult> {
		const modelSuffix = model ? ` model=${model}` : "";
		const board = await parseBoard();

		let task_id = targetTaskId;
		let reassigningFrom = "";

		if (task_id) {
			// Specific claim or reassign
			validateTaskId(task_id);
			const task = board.tasks.get(task_id);
			if (!task || task.deleted) return ok(`TASK_NOT_FOUND: ${task_id}`, { agent, task_id, result: "TASK_NOT_FOUND", claimed: false });
			if (task.col === "in-progress") {
				// Reassign path
				reassigningFrom = task.claimAgent || "unknown";
			} else if (task.col !== "todo") {
				return ok(`WRONG_COLUMN: ${task_id} is in '${task.col}', expected 'todo' or 'in-progress'`, { agent, task_id, result: "WRONG_COLUMN", col: task.col, claimed: false });
			}
		} else {
			// Pick path
			let bestId = "";
			let bestPri = 99;
			for (const tid of board.order) {
				const t = board.tasks.get(tid);
				if (!t || t.col !== "todo" || t.claimed) continue;
				const pri = PRIORITY_ORDER[t.priority] ?? 99;
				if (pri < bestPri || (pri === bestPri && parseInt(tid.slice(2), 10) < parseInt(bestId.slice(2), 10))) {
					bestPri = pri;
					bestId = tid;
				}
			}
			if (!bestId) return ok("NO_TASK_AVAILABLE", { agent, result: "NO_TASK_AVAILABLE", claimed: false });
			task_id = bestId;
		}

		if (!reassigningFrom) {
			// WIP check only applies to new claims
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) return ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, task_id, result: "WIP_LIMIT_REACHED", claimed: false });
		}

		const ts = nowZ();
		const expires = new Date(Date.now() + 7_200_000).toISOString();

		if (reassigningFrom) {
			await logAppend(`${ts} UNCLAIM ${task_id} ${sanitiseAgent(reassigningFrom)}`);
			await logAppend(`${ts} CLAIM ${task_id} ${sanitiseAgent(agent)} expires=${expires}${modelSuffix}`);
		} else {
			const fromCol = board.tasks.get(task_id)?.col ?? "todo";
			await logAppend(`${ts} CLAIM ${task_id} ${sanitiseAgent(agent)} expires=${expires}${modelSuffix}`);
			await logAppend(`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=${fromCol} to=in-progress`);
		}

		const verifyBoard = await parseBoard();
		const verified = verifyBoard.tasks.get(task_id);
		if (verified && verified.claimAgent !== agent) {
			await logAppend(`${ts} UNCLAIM ${task_id} ${sanitiseAgent(agent)}`);
			if (reassigningFrom) {
				// Revert unclaim
				await logAppend(`${ts} CLAIM ${task_id} ${sanitiseAgent(reassigningFrom)}`);
			}
			return ok(
				`CLAIM_CONFLICT: ${task_id} was claimed by ${verified.claimAgent}. Try again.`,
				{ agent, task_id, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verified.claimAgent },
			);
		}

		const task = verifyBoard.tasks.get(task_id);
		if (reassigningFrom) {
			return ok(`Reassigned ${task_id}: ${reassigningFrom} → ${agent}`, { task_id, agent, oldAgent: reassigningFrom, newAgent: agent, expires });
		}

		return ok(
			`Claimed ${task_id} ("${task?.title}") for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
			{ agent, task_id, title: task?.title, priority: task?.priority, tags: task?.tags, expires, result: "CLAIMED", claimed: true },
		);
	}

	// ── kanban_claim (Unified) ──────────────────────────────────
	pi.registerTool({
		name: "kanban_claim",
		label: "Kanban Claim",
		description:
			"Claim a task for an agent. " +
			"If task_id is provided and in 'todo', it will be claimed. " +
			"If task_id is provided and in 'in-progress', it will be reassigned to the new agent. " +
			"If task_id is omitted, the highest-priority 'todo' task will be picked automatically. " +
			"Returns TASK_NOT_FOUND, WRONG_COLUMN, WIP_LIMIT_REACHED, or CLAIMED.",
		promptSnippet: "Claim, pick, or reassign a kanban task for an agent",
		parameters: Type.Object({
			task_id: Type.Optional(TASK_ID_SCHEMA),
			agent: Type.String({ description: 'Agent name to claim for (lowercase, hyphens only, e.g. "time-crystals")' }),
			model: Type.Optional(Type.String({ description: 'Model running the agent (e.g. "google-gemini-cli/gemini-2.5-flash")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return performClaim(params.agent, params.task_id, params.model);
		},
	});
}
