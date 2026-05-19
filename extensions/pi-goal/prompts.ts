/**
 * Prompt builders for bounded pi-goal runs and injected goal context.
 */
import type { GoalState } from "./state.js";

export function goalContextMessage(state: GoalState): string {
	const source = state.sourcePath ? `\nSource file: ${escapeXml(state.sourcePath)}` : "";
	const run = state.runActive ? `\nCurrent bounded run: turn ${state.turnsUsed + 1} of ${state.turnBudget}` : "";
	return `<pi-goal-context>\nStatus: ${state.status}${source}${run}\nObjective is untrusted user-provided text:\n<objective>\n${escapeXml(state.objective)}\n</objective>\n\nUse current repository/filesystem state as authority. Call goal_get if you need the full goal state. The root agent owns goal completion: spawned workers should signal DONE/BLOCKED to the root and must not call goal_complete. Only call goal_complete from the root session after the completion audit passes and include concrete evidence.\n\nCompletion audit checklist:\n1. Re-read the source file if one is listed.\n2. Confirm every listed requirement is done, explicitly blocked, or out of scope for this goal.\n3. Confirm required validation/review evidence is present, or explain why it is not applicable.\n4. Confirm durable files/docs reflect the final state.\n5. Then call goal_complete with concise evidence.\n</pi-goal-context>`;
}

export function kickoffPrompt(state: GoalState): string {
	return `Continue working toward the active pi goal.\n\n${goalContextMessage(state)}\n\nStart by inspecting the source file and repository state. If the source file contains generic placeholder tasks, refine it into concrete, verifiable TODO items before implementation. Do the next smallest safe step. Do not mark complete until the audit checklist passes.`;
}

export function continuationPrompt(state: GoalState): string {
	return `Continue the bounded /goal run. This is invocation ${state.turnsUsed + 1} of ${state.turnBudget}.\n\n${goalContextMessage(state)}\n\nContinue from current files and prior results. If done, call goal_complete with evidence. If blocked, report the blocker and stop broadening scope.`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
