/**
 * Kanban complete tool registration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { ok, type ToolResult } from "../../lib/tool-result.js";
import type { TaskVerificationCheck } from "./board.js";
import { orchestrateTaskCompletion } from "./board-actions.js";
import { CHECK_ITEM_SCHEMA, TASK_ID_SCHEMA } from "./schemas.js";

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
			await orchestrateTaskCompletion(task_id, agent, {
				duration,
				checks,
				cwd: ctx?.cwd ?? process.cwd(),
				signal,
			});
			return ok(`Completed ${task_id} (agent=${agent}, duration=${duration})`, {
				task_id,
				agent,
				duration,
				checks,
			});
		},
	});
}