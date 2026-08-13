/**
 * Kanban claim and assignment tool registrations.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import {
	nowZ,
	PRIORITY_ORDER,
	sanitiseAgent,
	validateTaskId,
	WIP_LIMIT,
} from "./board.js";
import { withBoardTransaction } from "./board-transactions.js";
import { TASK_ID_SCHEMA } from "./schemas.js";

export function registerClaimTools(pi: ExtensionAPI): void {
	async function performClaim(
		agent: string,
		targetTaskId?: string,
		model?: string,
	): Promise<ToolResult> {
		return withBoardTransaction((board) => {
			const modelSuffix = model ? ` model=${model}` : "";
			let taskId = targetTaskId;
			let reassigningFrom = "";

			if (taskId) {
				validateTaskId(taskId);
				const task = board.tasks.get(taskId);
				if (!task || task.deleted) {
					return {
						events: [],
						result: ok(`TASK_NOT_FOUND: ${taskId}`, {
							agent,
							task_id: taskId,
							result: "TASK_NOT_FOUND",
							claimed: false,
						}),
					};
				}
				if (task.col === "in-progress") {
					reassigningFrom = task.claimAgent || "unknown";
				} else if (task.col !== "todo") {
					return {
						events: [],
						result: ok(
							`WRONG_COLUMN: ${taskId} is in '${task.col}', expected 'todo' or 'in-progress'`,
							{
								agent,
								task_id: taskId,
								result: "WRONG_COLUMN",
								col: task.col,
								claimed: false,
							},
						),
					};
				}
			} else {
				let bestId = "";
				let bestPriority = 99;
				for (const candidateId of board.order) {
					const candidate = board.tasks.get(candidateId);
					if (!candidate || candidate.col !== "todo" || candidate.claimed) {
						continue;
					}
					const priority = PRIORITY_ORDER[candidate.priority] ?? 99;
					if (
						priority < bestPriority ||
						(priority === bestPriority &&
							parseInt(candidateId.slice(2), 10) < parseInt(bestId.slice(2), 10))
					) {
						bestPriority = priority;
						bestId = candidateId;
					}
				}
				if (!bestId) {
					return {
						events: [],
						result: ok("NO_TASK_AVAILABLE", {
							agent,
							result: "NO_TASK_AVAILABLE",
							claimed: false,
						}),
					};
				}
				taskId = bestId;
			}

			if (!reassigningFrom) {
				const wip = [...board.tasks.values()].filter(
					(task) => task.col === "in-progress",
				).length;
				if (wip >= WIP_LIMIT) {
					return {
						events: [],
						result: ok(`WIP_LIMIT_REACHED (${wip}/${WIP_LIMIT})`, {
							agent,
							task_id: taskId,
							result: "WIP_LIMIT_REACHED",
							claimed: false,
						}),
					};
				}
			}

			const timestamp = nowZ();
			const expires = new Date(Date.now() + 7_200_000).toISOString();
			const safeAgent = sanitiseAgent(agent);
			if (reassigningFrom) {
				return {
					events: [
						`${timestamp} UNCLAIM ${taskId} ${sanitiseAgent(reassigningFrom)}`,
						`${timestamp} CLAIM ${taskId} ${safeAgent} expires=${expires}${modelSuffix}`,
					],
					result: ok(`Reassigned ${taskId}: ${reassigningFrom} → ${agent}`, {
						task_id: taskId,
						agent,
						oldAgent: reassigningFrom,
						newAgent: agent,
						expires,
					}),
				};
			}

			const task = board.tasks.get(taskId);
			const fromColumn = task?.col ?? "todo";
			return {
				events: [
					`${timestamp} CLAIM ${taskId} ${safeAgent} expires=${expires}${modelSuffix}`,
					`${timestamp} MOVE ${taskId} ${safeAgent} from=${fromColumn} to=in-progress`,
				],
				result: ok(
					`Claimed ${taskId} ("${task?.title}") for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
					{
						agent,
						task_id: taskId,
						title: task?.title,
						priority: task?.priority,
						tags: task?.tags,
						expires,
						result: "CLAIMED",
						claimed: true,
					},
				),
			};
		});
	}

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
			agent: Type.String({
				description:
					'Agent name to claim for (lowercase, hyphens only, e.g. "time-crystals")',
			}),
			model: Type.Optional(
				Type.String({
					description:
						'Model running the agent (e.g. "google-gemini-cli/gemini-2.5-flash")',
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			return performClaim(params.agent, params.task_id, params.model);
		},
	});
}
