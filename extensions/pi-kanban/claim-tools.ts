/**
 * Kanban claim and assignment tool registrations.
 * The claim transaction and conflict policy live in board-actions.ts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import { WIP_LIMIT } from "./board.js";
import { claimTask, type ClaimOutcome } from "./board-actions.js";
import { TASK_ID_SCHEMA } from "./schemas.js";

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
		case "in-progress-owner":
			// Tools may reassign; claimOnly is an overlay policy, so this
			// outcome never reaches the tool surface. Treated as a reassignment
			// precondition failure defensively.
			return ok(
				`WRONG_COLUMN: ${outcome.taskId} is in 'in-progress' (owner ${outcome.owner})`,
				{
					agent,
					task_id: outcome.taskId,
					result: "WRONG_COLUMN",
					col: "in-progress",
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