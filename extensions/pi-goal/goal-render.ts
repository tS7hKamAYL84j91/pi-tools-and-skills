/** Human-readable goal summary and retained per-iteration evidence. */
import type { GoalState } from "./goal-types.js";

export function renderGoalOverlayLines(text: string, maxLines: number): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) return lines;
	return [...lines.slice(0, maxLines - 1), `… ${lines.length - maxLines + 1} more lines in .pi/goal/instances/<goalId>/GOAL.md`];
}

export function renderGoalSummary(state: GoalState): string {
	const source = state.sourcePath ? `\n${state.schemaVersion >= 3 ? "Source (untrusted)" : "Source"}: ${state.sourcePath}` : "";
	const mode = state.runMode ? `\nRun mode: ${state.runMode}` : "";
	const execution = state.executionState ? `\nExecution: ${state.executionState}` : "";
	const run = state.runActive ? `\nRun: ${state.turnBudget > 0 ? `${state.turnsUsed}/${state.turnBudget}` : `${state.turnsUsed}/∞`}` : "";
	const evidence = state.completionEvidence ? `\nEvidence: ${state.completionEvidence}` : "";
	const error = state.lastError ? `\nLast error: ${state.lastError}` : "";
	const objectiveLabel = state.schemaVersion >= 3 ? "Objective (untrusted)" : "Objective";
	return `Goal ${state.goalId}\nStatus: ${state.status}${mode}${execution}${source}${run}\n${objectiveLabel}: ${state.objective}${evidence}${error}`;
}

export function renderGoalMarkdown(state: GoalState): string {
	const lifecycle = (state.lifecycle ?? []).slice(-5).map((event) => `- ${event.timestamp} ${event.kind}: ${event.summary}`).join("\n");
	const changedFiles = (state.changedFiles ?? []).slice(-20).map((file) => `- ${file}`).join("\n");
	return `# Current pi Goal\n\n${renderGoalSummary(state)}\n` +
		(lifecycle ? `\n## Recent activity (reported)\n\n${lifecycle}\n` : "") +
		(changedFiles ? `\n## Changed files (bounded, reported)\n\n${changedFiles}\n` : "");
}

export function renderIterationMarkdown(state: GoalState, iteration: number): string {
	return `# pi Goal Iteration ${iteration}\n\n${renderGoalSummary(state)}\n`;
}
