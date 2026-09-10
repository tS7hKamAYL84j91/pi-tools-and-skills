/**
 * Kanban claim and assignment tool registrations.
 *
 * Also hosts the shared claim transaction (withBoardTransaction) so claim
 * conflict handling — UNCLAIM+CLAIM reassignment without compensating
 * appends — stays beside the tool surface that depends on it.
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

type ClaimOutcome =
	| {
			status: "claimed";
			taskId: string;
			title: string;
			priority: string;
			tags: string;
			expires: string;
	  }
	| {
			status: "reassigned";
			taskId: string;
			oldAgent: string;
			newAgent: string;
			expires: string;
	  }
	| { status: "task-not-found"; taskId: string }
	| { status: "wrong-column"; taskId: string; col: string }
	| { status: "wip-limit"; taskId: string; wip: number }
	| { status: "no-task" };

/** Claim a specific or auto-picked todo task, or reassign an in-progress task. */
export async function claimTask(
	agent: string,
	targetTaskId?: string,
	model?: string,
): Promise<ClaimOutcome> {
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
					result: { status: "task-not-found", taskId } as ClaimOutcome,
				};
			}
			if (task.col === "in-progress") {
				reassigningFrom = task.claimAgent || "unknown";
			} else if (task.col !== "todo") {
				return {
					events: [],
					result: {
						status: "wrong-column",
						taskId,
						col: task.col,
					} as ClaimOutcome,
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
					result: { status: "no-task" } as ClaimOutcome,
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
					result: {
						status: "wip-limit",
						taskId: taskId as string,
						wip,
					} as ClaimOutcome,
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
				result: {
					status: "reassigned",
					taskId: taskId as string,
					oldAgent: reassigningFrom,
					newAgent: agent,
					expires,
				} as ClaimOutcome,
			};
		}

		const task = board.tasks.get(taskId);
		const fromColumn = task?.col ?? "todo";
		return {
			events: [
				`${timestamp} CLAIM ${taskId} ${safeAgent} expires=${expires}${modelSuffix}`,
				`${timestamp} MOVE ${taskId} ${safeAgent} from=${fromColumn} to=in-progress`,
			],
			result: {
				status: "claimed",
				taskId: taskId as string,
				title: task?.title ?? "",
				priority: task?.priority ?? "medium",
				tags: task?.tags ?? "",
				expires,
			} as ClaimOutcome,
		};
	});
}

/** Map a shared claim outcome to the historical tool result text and details. */
function claimOutcomeToResult(
	agent: string,
	outcome: ClaimOutcome,
): ToolResult {
	switch (outcome.status) {
		case "task-not-found":
			return ok(`TASK_NOT_FOUND: ${outcome.taskId}`, {
				agent,
				task_id: outcome.taskId,
				result: "TASK_NOT_FOUND",
				claimed: false,
			});
		case "wrong-column":
			return ok(
				`WRONG_COLUMN: ${outcome.taskId} is in '${outcome.col}', expected 'todo' or 'in-progress'`,
				{
					agent,
					task_id: outcome.taskId,
					result: "WRONG_COLUMN",
					col: outcome.col,
					claimed: false,
				},
			);
		case "wip-limit":
			return ok(`WIP_LIMIT_REACHED (${outcome.wip}/${WIP_LIMIT})`, {
				agent,
				task_id: outcome.taskId,
				result: "WIP_LIMIT_REACHED",
				claimed: false,
			});
		case "no-task":
			return ok("NO_TASK_AVAILABLE", {
				agent,
				result: "NO_TASK_AVAILABLE",
				claimed: false,
			});
		case "reassigned":
			return ok(
				`Reassigned ${outcome.taskId}: ${outcome.oldAgent} → ${outcome.newAgent}`,
				{
					task_id: outcome.taskId,
					agent,
					oldAgent: outcome.oldAgent,
					newAgent: outcome.newAgent,
					expires: outcome.expires,
				},
			);
		case "claimed":
			return ok(
				`Claimed ${outcome.taskId} ("${outcome.title}") for agent "${agent}".\nRun kanban_snapshot to see full task details.`,
				{
					agent,
					task_id: outcome.taskId,
					title: outcome.title,
					priority: outcome.priority,
					tags: outcome.tags,
					expires: outcome.expires,
					result: "CLAIMED",
					claimed: true,
				},
			);
		default: {
			const exhaustive: never = outcome;
			throw new Error(`Unexpected claim outcome: ${String(exhaustive)}`);
		}
	}
}

export function registerClaimTools(pi: ExtensionAPI): void {
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
			const outcome = await claimTask(params.agent, params.task_id, params.model);
			return claimOutcomeToResult(params.agent, outcome);
		},
	});
}