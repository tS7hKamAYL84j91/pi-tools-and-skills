/**
 * Plan generation and plan-state transition helpers.
 */
import { randomUUID } from "node:crypto";
import type { GoalState, GoalStatus, Milestone } from "./goal-types.js";

export function getCurrentMilestone(state: GoalState): Milestone | undefined {
	return state.milestones[state.currentMilestoneIndex];
}

function defaultMilestones(objective: string): Milestone[] {
	const tasks: string[] = [];
	for (const line of objective.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const bullet = trimmed.match(/^[-*]\s+(.+)$/);
		const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
		const match = bullet ?? numbered;
		if (match?.[1]) tasks.push(match[1]);
	}
	if (tasks.length === 0) {
		return [{
			id: "m-1",
			title: "Implement and validate the objective",
			validationCommand: "npm run check && npm test",
			status: "pending",
		}];
	}
	return tasks.map((task, index) => ({
		id: `m-${index + 1}`,
		title: task,
		validationCommand: "npm run check && npm test",
		status: "pending",
	}));
}

export function generatePlanState(
	state: GoalState,
	milestones?: readonly Milestone[],
): GoalState {
	const effectiveMilestones = milestones && milestones.length > 0
		? milestones
		: defaultMilestones(state.objective);
	const next = effectiveMilestones.map((m, i) =>
		i === 0 ? { ...m, status: "in_progress" as const } : m,
	);
	return updateGoal(state, {
		schemaVersion: 2,
		status: "planning",
		runActive: false,
		planRequired: true,
		planApproved: false,
		currentMilestoneIndex: 0,
		milestones: next,
		lastVerification: undefined,
	});
}

export function approvePlan(state: GoalState): GoalState {
	if (!state.planRequired) {
		throw new Error("No plan is required for this goal.");
	}
	const milestones: readonly Milestone[] = state.milestones.length > 0
		? state.milestones.map((m, i) =>
			m.status === "pending" && i === state.currentMilestoneIndex
				? { ...m, status: "in_progress" as const }
				: m,
		)
		: state.milestones;
	return updateGoal(state, {
		planApproved: true,
		status: state.status === "planning" ? "active" : state.status,
		milestones,
	});
}

export function invalidatePlan(state: GoalState): GoalState {
	const resetMilestones: readonly Milestone[] = state.milestones.map((m) =>
		({ ...m, status: "pending" as const }),
	);
	return updateGoal(state, {
		planApproved: false,
		currentMilestoneIndex: 0,
		status: state.status === "complete" ? "active" : (state.status as GoalStatus),
		lastVerification: undefined,
		milestones: resetMilestones,
	});
}

export function updateGoal(
	state: GoalState,
	patch: Partial<GoalState>,
): GoalState {
	return {
		...state,
		...patch,
		updatedAt: new Date().toISOString(),
	};
}

export function startRun(state: GoalState, turnBudget: number): GoalState {
	return updateGoal(state, {
		status: state.status === "planning" ? "active" : state.status,
		runId: `run-${randomUUID()}`,
		runStartedAt: new Date().toISOString(),
		runActive: true,
		turnBudget,
		turnsUsed: 0,
		lastError: undefined,
	});
}

