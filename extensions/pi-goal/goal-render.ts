/**
 * Markdown rendering helpers for pi-goal durable artifacts.
 */
import { getCurrentMilestone } from "./goal-plan.js";
import type { GoalState, Milestone } from "./goal-types.js";

export function renderGoalOverlayLines(text: string, maxLines: number): string[] {
	const lines = text.split("\n");
	if (lines.length <= maxLines) {
		return lines;
	}
	return [...lines.slice(0, maxLines - 1), `… ${lines.length - maxLines + 1} more lines in .pi/goal/GOAL.md`];
}

export function renderGoalSummary(state: GoalState): string {
	const source = state.sourcePath ? `\nSource: ${state.sourcePath}` : "";
	const run = state.runActive
		? `\nRun: ${state.turnsUsed}/${state.turnBudget}`
		: "";
	const evidence = state.completionEvidence
		? `\nEvidence: ${state.completionEvidence}`
		: "";
	const error = state.lastError ? `\nLast error: ${state.lastError}` : "";
	const plan = state.planRequired
		? `\nPlan: ${state.planApproved ? "approved" : "pending approval"} · milestone ${state.currentMilestoneIndex + 1}/${state.milestones.length}`
		: "";
	const milestone = getCurrentMilestone(state);
	const milestoneLine = milestone ? `\nCurrent milestone: ${milestone.title} (${milestone.status})` : "";
	return `Goal ${state.goalId}\nStatus: ${state.status}${source}${run}${plan}${milestoneLine}\nObjective: ${state.objective}${evidence}${error}`;
}

export function renderGoalMarkdown(state: GoalState): string {
	return `# Current pi Goal\n\n${renderGoalSummary(state)}\n`;
}

export function renderIterationMarkdown(state: GoalState, iteration: number): string {
	return `# pi Goal Iteration ${iteration}\n\n${renderGoalSummary(state)}\n`;
}

export function renderSpecMarkdown(state: GoalState): string {
	const doneWhen = state.planRequired && state.milestones.length > 0
		? state.milestones.map((m) => `- ${m.title}: \`${m.validationCommand}\``).join("\n")
		: "- Concrete evidence is recorded by calling goal_complete.";
	return `# SPEC — Goal Specification\n\n## Goal\n\n${state.objective}\n\n## Non-goals\n\n(None recorded yet.)\n\n## Constraints\n\n- Work stays inside this workspace.\n- No secrets, credentials, or API keys in goal artifacts.\n- Milestone validation evidence is structured and persisted; the extension does not execute arbitrary shell commands.\n\n## Done when\n\n${doneWhen}\n`;
}

export function renderPlanMarkdown(state: GoalState): string {
	const lines = state.milestones.map((m, i) => {
		const marker = milestoneMarker(m.status);
		return `${marker} ${i + 1}. ${m.title}\n   - Validate: \`${m.validationCommand}\`${m.decisionNotes ? `\n   - Decision notes: ${m.decisionNotes}` : ""}`;
	});
	return `# PLAN — Ordered Milestones\n\n${lines.join("\n\n")}\n\n---\n\n## Decision notes\n\nUse this section to record why the plan changed, what alternatives were rejected, and any blockers. Dated entries help later turns avoid re-litigating decisions.\n`;
}

export function renderStatusMarkdown(state: GoalState): string {
	const milestone = getCurrentMilestone(state);
	const verification = state.lastVerification
		? `Last verification: milestone ${state.lastVerification.milestoneIndex + 1} · \`${state.lastVerification.command}\` · exitCode=${state.lastVerification.exitCode} · ${state.lastVerification.timestamp}`
		: "No verification recorded for the current milestone.";
	return `# STATUS — Live Audit Log\n\n- Current milestone: ${milestone ? `${milestone.title} (${milestone.status})` : "none"}\n- ${verification}\n- Turns used: ${state.turnsUsed}/${state.turnBudget}\n- Last error: ${state.lastError ?? "none"}\n\n## Iteration notes\n\nRecord blockers, decisions, and validation outcomes here after each turn.\n`;
}

export function renderTodoMarkdown(objective: string): string {
	return `# TODO — Remaining Work

Single tracker for active work on this goal.

## Goal

${objective}

**🔴 AUTONOMY RULE — READ FIRST:**
The implementation agent is expected to complete outstanding items without asking the user for confirmation.

- Pick work from this TODO, implement it, validate it, and update this file.
- Use the smallest useful change.
- Preserve useful content; do not delete source material unless it is clearly duplicate, empty, generated junk, or moved with an auditable note.
- Prefer moves/renames over rewrites.
- Escalate architecture, security, broad policy decisions, or destructive cleanup to \`llm-council\` when available.
- Use \`navigator\` review when substantial repo changes are made and team tools are available.

Progress markers:
- \`[ ]\` Planned
- \`[~]\` In progress
- \`[R]\` Ready for review
- \`[x]\` Done
- \`[!]\` Blocked

---

## How to use this TODO

1. Claim an item — change \`[ ]\` to \`[~]\` and add a dated note with intended scope.
2. Implement the smallest useful change.
3. Refactor only as needed to keep the result simple.
4. Validate with project checks or a documented manual check.
5. Update docs/architecture notes when the project requires it.
6. Change to \`[R]\` when ready for review, then \`[x]\` after validation/review.
7. If blocked, change to \`[!]\`, record the blocker and next decision needed, then stop broadening scope.

## Remaining TODO Items

- [ ] (1.1) Inspect the current repository state and refine this TODO into concrete, verifiable tasks derived from the goal.
- [ ] (1.2) Implement the smallest useful change that advances the goal.
- [ ] (1.3) Validate the result and record evidence.
- [ ] (1.4) Final summary: what changed, what stayed unchanged, validation performed, and any blockers or follow-up work.

---

## Completion Criteria

- All TODO items are \`[x]\`, \`[R]\` with review notes, or \`[!]\` with explicit blockers.
- Required validation has passed or has a documented reason why it cannot run.
- Final state and evidence are recorded in this file.
`;
}

function milestoneMarker(status: Milestone["status"]): string {
	switch (status) {
		case "done": return "[x]";
		case "in_progress": return "[~]";
		case "blocked": return "[!]";
		default: return "[ ]";
	}
}
