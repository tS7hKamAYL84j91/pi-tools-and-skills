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
	getTask,
	logAppend,
	nowZ,
	parseBoard,
	sanitiseAgent,
	validateTaskId,
} from "./board.js";

export function registerClaimTools(pi: ExtensionAPI): void {
	// ── kanban_pick ─────────────────────────────────────────────
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
			agent: Type.String({ description: 'Agent name claiming the task (lowercase, hyphens only, e.g. "tools-worker")' }),
			model: Type.Optional(Type.String({ description: 'Model running the agent (e.g. "claude-sonnet-4-6")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			const board = await parseBoard();
			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) return ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, result: "WIP_LIMIT_REACHED", claimed: false });

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

			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			const fromCol = board.tasks.get(bestId)?.col ?? "todo";
			await logAppend(`${ts} CLAIM ${bestId} ${sanitiseAgent(agent)} expires=${expires}${modelSuffix}`);
			await logAppend(`${ts} MOVE ${bestId} ${sanitiseAgent(agent)} from=${fromCol} to=in-progress`);

			const verifyBoard = await parseBoard();
			const verified = verifyBoard.tasks.get(bestId);
			if (verified && verified.claimAgent !== agent) {
				await logAppend(`${ts} UNCLAIM ${bestId} ${sanitiseAgent(agent)}`);
				return ok(
					`CLAIM_CONFLICT: ${bestId} was claimed by ${verified.claimAgent}. Call kanban_pick again.`,
					{ agent, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verified.claimAgent },
				);
			}
			return ok(`Claimed ${bestId} for agent "${agent}".\nRun kanban_snapshot to see full task details.`, { agent, result: bestId, claimed: true });
		},
	});

	// ── kanban_claim ──────────────────────────────────────────────
	pi.registerTool({
		name: "kanban_claim",
		label: "Kanban Claim",
		description:
			"Claim a specific task for a specific agent. " +
			"Task must be in the todo column. Moves it to in-progress. " +
			"Returns TASK_NOT_FOUND if the ID is unknown, WRONG_COLUMN if not in todo, " +
			"or WIP_LIMIT_REACHED if the 3-task in-progress cap is hit.",
		promptSnippet: "Claim a specific kanban task for a specific agent",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: 'Agent name to claim for (lowercase, hyphens only, e.g. "time-crystals")' }),
			model: Type.Optional(Type.String({ description: 'Model running the agent (e.g. "google-gemini-cli/gemini-2.5-flash")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			validateTaskId(task_id);
			const board = await parseBoard();

			const task = board.tasks.get(task_id);
			if (!task || task.deleted) return ok(`TASK_NOT_FOUND: ${task_id}`, { agent, task_id, result: "TASK_NOT_FOUND", claimed: false });
			if (task.col !== "todo") return ok(`WRONG_COLUMN: ${task_id} is in '${task.col}', expected 'todo'`, { agent, task_id, result: "WRONG_COLUMN", col: task.col, claimed: false });

			const wip = [...board.tasks.values()].filter((t) => t.col === "in-progress").length;
			if (wip >= WIP_LIMIT) return ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, { agent, task_id, result: "WIP_LIMIT_REACHED", claimed: false });

			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await logAppend(`${ts} CLAIM ${task_id} ${sanitiseAgent(agent)} expires=${expires}${modelSuffix}`);
			await logAppend(`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=todo to=in-progress`);

			const verifyBoard = await parseBoard();
			const verified = verifyBoard.tasks.get(task_id);
			if (verified && verified.claimAgent !== agent) {
				await logAppend(`${ts} UNCLAIM ${task_id} ${sanitiseAgent(agent)}`);
				return ok(
					`CLAIM_CONFLICT: ${task_id} was claimed by ${verified.claimAgent}. Try again.`,
					{ agent, task_id, result: "CLAIM_CONFLICT", claimed: false, conflictWith: verified.claimAgent },
				);
			}

			return ok(
				`Claimed ${task_id} ("${task.title}") for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
				{ agent, task_id, title: task.title, priority: task.priority, tags: task.tags, expires, result: "CLAIMED", claimed: true },
			);
		},
	});

	// ── kanban_reassign ─────────────────────────────────────────
	pi.registerTool({
		name: "kanban_reassign",
		label: "Kanban Reassign",
		description: "Transfer an in-progress task from one agent to another. Unclaims from the current agent and claims for the new agent with a fresh 2h expiry.",
		promptSnippet: "Reassign an in-progress kanban task to a different agent",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({ description: 'Agent performing the reassignment (e.g. "lead")' }),
			new_agent: Type.String({ description: "Agent receiving the task (lowercase, hyphens only)" }),
			model: Type.Optional(Type.String({ description: 'Model running the new agent (e.g. "claude-sonnet-4-6")' })),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent, new_agent } = params;
			const modelSuffix = params.model ? ` model=${params.model}` : "";
			validateTaskId(task_id);
			const task = await getTask(task_id);
			if (task.col !== "in-progress") throw new Error(`Task ${task_id} is in '${task.col}' column. Can only reassign in-progress tasks.`);
			const oldAgent = task.claimAgent || "unknown";
			const ts = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			await logAppend(`${ts} UNCLAIM ${task_id} ${sanitiseAgent(oldAgent)}`);
			await logAppend(`${ts} CLAIM ${task_id} ${sanitiseAgent(new_agent)} expires=${expires}${modelSuffix}`);
			return ok(`Reassigned ${task_id}: ${oldAgent} → ${new_agent}`, { task_id, agent, oldAgent, newAgent: new_agent, expires });
		},
	});
}
