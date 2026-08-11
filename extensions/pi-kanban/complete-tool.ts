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
	logAppend,
	nowZ,
	parseBoard,
	sanitiseAgent,
	type TaskState,
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

function verificationRequired(task: TaskState, explicitChecks?: TaskVerificationCheck[]): boolean {
	return task.verificationRequired || process.env.KANBAN_REQUIRE_CHECK_EVIDENCE === "1" || Boolean(explicitChecks?.length);
}

interface ValidateOptions {
	readonly gateCommand?: string;
	readonly signal?: AbortSignal;
}

async function validateTaskComplete(
	taskId: string,
	agent: string,
	checks: TaskVerificationCheck[],
	options: ValidateOptions = {},
): Promise<TaskState> {
	const task = await getTask(taskId);
	if (task.col !== "in-progress")
		throw new Error(`Task ${taskId} is not in-progress (col=${task.col})`);
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
	if (options.gateCommand) {
		const gate = await runGateCommand(options.gateCommand, process.cwd(), options.signal);
		if (!gate.passed) {
			throw new Error(
				`kanban_complete gate failed for ${taskId} (exitCode=${gate.exitCode}): ${gate.stderrSummary || gate.stdoutSummary}`,
			);
		}
	}
	return task;
}

interface LogLineInputs {
	readonly taskId: string;
	readonly agent: string;
	readonly duration: string;
	readonly needsVerification: boolean;
	readonly checks: TaskVerificationCheck[];
}

function completeLogLine(inputs: LogLineInputs): string {
	const verificationPayload = inputs.needsVerification ? " verification_required=true" : "";
	const checkPayload = inputs.checks.length > 0 ? ` checks="${escapeLogValue(formatChecks(inputs.checks))}"` : "";
	return `${nowZ()} COMPLETE ${inputs.taskId} ${sanitiseAgent(inputs.agent)} duration=${inputs.duration}${verificationPayload}${checkPayload}`;
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
			gate_command: Type.Optional(
				Type.String({
					description: "Optional command that must exit 0 before the task is marked complete.",
				}),
			),
		}),
		async execute(_id, params, _signal): Promise<ToolResult> {
			const { task_id, agent } = params;
			const duration = params.duration ?? "unknown";
			const checks = normalizeChecks(params.checks);
			const task = await validateTaskComplete(task_id, agent, checks, {
				gateCommand: params.gate_command,
				signal: _signal,
			});
			const needsVerification = verificationRequired(task, checks);
			const ts = nowZ();
			await logAppend(
				completeLogLine({ taskId: task_id, agent, duration, needsVerification, checks }),
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
