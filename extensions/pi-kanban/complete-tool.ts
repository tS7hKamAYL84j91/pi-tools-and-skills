/**
 * Kanban complete tool registration.
 */
import { runGateCommand } from "../../lib/gate-command.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import {
	escapeLogValue,
	getTask,
	nowZ,
	parseBoard,
	sanitiseAgent,
	type TaskState,
	type TaskVerificationCheck,
} from "./board.js";
import { withBoardTransaction } from "./board-transactions.js";
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

function verificationRequired(task: TaskState, explicitChecks?: TaskVerificationCheck[]): boolean {
	return task.verificationRequired || process.env.KANBAN_REQUIRE_CHECK_EVIDENCE === "1" || Boolean(explicitChecks?.length);
}

function validateTaskComplete(
	task: TaskState,
	taskId: string,
	agent: string,
	checks: TaskVerificationCheck[],
): void {
	if (task.col !== "in-progress") {
		throw new Error(`Task ${taskId} is not in-progress (col=${task.col})`);
	}
	if (task.claimAgent !== sanitiseAgent(agent)) {
		throw new Error(
			`Agent ${agent} is not the claimed owner of ${taskId} (claimed by ${task.claimAgent || "nobody"})`,
		);
	}
	if (verificationRequired(task, checks) && !hasPassingChecks(checks)) {
		throw new Error(
			`Task ${taskId} requires verification evidence with all exit_code=0 before completion`,
		);
	}
}

interface LogLineInputs {
	readonly timestamp: string;
	readonly taskId: string;
	readonly agent: string;
	readonly duration: string;
	readonly needsVerification: boolean;
	readonly checks: TaskVerificationCheck[];
}

function completeLogLine(inputs: LogLineInputs): string {
	const verificationPayload = inputs.needsVerification ? " verification_required=true" : "";
	const checkPayload = inputs.checks.length > 0 ? ` checks="${escapeLogValue(formatChecks(inputs.checks))}"` : "";
	return `${inputs.timestamp} COMPLETE ${inputs.taskId} ${sanitiseAgent(inputs.agent)} duration=${inputs.duration}${verificationPayload}${checkPayload}`;
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
			gate_command: Type.Optional(Type.String({
				description: "Deprecated compatibility input. Ignored and never executed; only KANBAN_GATE_COMMAND configures the trusted gate.",
				deprecated: true,
			})),
		}),
		async execute(_id, params, signal, _onUpdate, ctx): Promise<ToolResult> {
			const { task_id, agent } = params;
			const duration = params.duration ?? "unknown";
			const checks = normalizeChecks(params.checks);
			const initialTask = await getTask(task_id);
			validateTaskComplete(initialTask, task_id, agent, checks);
			const gateCommand = process.env.KANBAN_GATE_COMMAND;
			if (gateCommand !== undefined) {
				const gate = await runGateCommand(gateCommand, ctx.cwd, signal);
				if (!gate.passed) {
					throw new Error(
						`kanban_complete gate failed for ${task_id} (exitCode=${gate.exitCode}): ${gate.stderrSummary || gate.stdoutSummary}`,
					);
				}
			}
			await withBoardTransaction((board) => {
				const task = board.tasks.get(task_id);
				if (!task) {
					throw new Error(`Task ${task_id} not found`);
				}
				validateTaskComplete(task, task_id, agent, checks);
				const needsVerification = verificationRequired(task, checks);
				const timestamp = nowZ();
				const safeAgent = sanitiseAgent(agent);
				return {
					events: [
						completeLogLine({
							timestamp,
							taskId: task_id,
							agent,
							duration,
							needsVerification,
							checks,
						}),
						`${timestamp} MOVE ${task_id} ${safeAgent} from=in-progress to=done`,
					],
					result: undefined,
				};
			});
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
