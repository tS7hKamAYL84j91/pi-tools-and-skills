/**
 * Kanban complete tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import {
	escapeLogValue,
	getTask,
	logAppend,
	nowZ,
	parseBoard,
	sanitiseAgent,
	type TaskVerificationCheck,
} from "./board.js";
import { formatChecks } from "./board-event-handlers.js";
import { CHECK_ITEM_SCHEMA, TASK_ID_SCHEMA } from "./schemas.js";
import { compactIfNeeded } from "./compaction.js";

function normalizeChecks(raw: unknown): TaskVerificationCheck[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((c): c is Record<string, unknown> => c !== null && typeof c === "object")
		.map((c) => ({
			command: typeof c.command === "string" ? c.command : "",
			result: typeof c.result === "string" ? c.result : "",
			exitCode: typeof c.exit_code === "number" ? c.exit_code : typeof c.exitCode === "number" ? c.exitCode : -1,
		}))
		.filter((c) => c.command || c.result);
}

function hasPassingChecks(checks: TaskVerificationCheck[]): boolean {
	return checks.length > 0 && checks.every((c) => c.exitCode === 0);
}

function requireVerificationEvidence(task: { verificationRequired: boolean }, explicitChecks?: TaskVerificationCheck[]): boolean {
	if (task.verificationRequired || process.env.KANBAN_REQUIRE_CHECK_EVIDENCE === "1") return true;
	return Boolean(explicitChecks && explicitChecks.length > 0);
}

export function registerKanbanComplete(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "kanban_complete",
		label: "Kanban Complete",
		description:
			"Mark an in-progress task as done. Optionally provide how long the task took (e.g. '45m', '2h'). " +
			"When verification is required, provide a checks array with command, result, and exit_code; " +
			"completion is rejected if checks are missing or any exit_code is not 0.",
		promptSnippet: "Mark a kanban task as completed",
		parameters: Type.Object({
			task_id: TASK_ID_SCHEMA,
			agent: Type.String({
				description:
					"Agent name that completed the task (must match the claiming agent)",
			}),
			duration: Type.Optional(
				Type.String({
					description: 'Optional duration string (e.g. "45m", "2h", "107m")',
					default: "unknown",
				}),
			),
			checks: Type.Optional(
				Type.Array(CHECK_ITEM_SCHEMA, {
					description:
						"Optional verification evidence. Required when task.verificationRequired is true or KANBAN_REQUIRE_CHECK_EVIDENCE=1.",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const duration = params.duration ?? "unknown";
			const checks = normalizeChecks(params.checks);
			const task = await getTask(task_id);
			if (task.col !== "in-progress")
				throw new Error(`Task ${task_id} is not in-progress (col=${task.col})`);
			if (task.claimAgent !== sanitiseAgent(agent)) {
				throw new Error(
					`Agent ${agent} is not the claimed owner of ${task_id} (claimed by ${task.claimAgent || "nobody"})`,
				);
			}
			if (requireVerificationEvidence(task, checks) && !hasPassingChecks(checks)) {
				throw new Error(
					`Task ${task_id} requires verification evidence with all exit_code=0 before completion`,
				);
			}
			const ts = nowZ();
			const verificationPayload = task.verificationRequired || requireVerificationEvidence(task, checks)
				? ` verification_required=true`
				: "";
			const checkPayload = checks.length > 0 ? ` checks="${escapeLogValue(formatChecks(checks))}"` : "";
			await logAppend(
				`${ts} COMPLETE ${task_id} ${sanitiseAgent(agent)} duration=${duration}${verificationPayload}${checkPayload}`,
			);
			await logAppend(
				`${ts} MOVE ${task_id} ${sanitiseAgent(agent)} from=in-progress to=done`,
			);
			// Auto-compaction checkpoint: completing a task is a natural housekeeping moment
			const boardAfter = await parseBoard();
			await compactIfNeeded(boardAfter, boardAfter.totalEvents, "complete");
			return ok(`Completed ${task_id} (agent=${agent}, duration=${duration})`, {
				task_id,
				agent,
				duration,
				checks,
			});
		},
	});
}
