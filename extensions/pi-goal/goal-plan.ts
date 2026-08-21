/**
 * Plan generation and plan-state transition helpers.
 */
import { randomUUID } from "node:crypto";
import type {
	GoalLifecycleEvent,
	GoalRunMode,
	GoalState,
	GoalStatus,
	Milestone,
} from "./goal-types.js";

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
	return withLifecycle(updateGoal(state, {
		schemaVersion: 3,
		status: "planning",
		executionState: "idle",
		runActive: false,
		planRequired: true,
		planApproved: false,
		currentMilestoneIndex: 0,
		milestones: next,
		lastVerification: undefined,
		milestoneRevision: (state.milestoneRevision ?? 0) + 1,
	}), "plan_updated", "Plan updated; milestone verification was invalidated.");
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
	return withLifecycle(updateGoal(state, {
		planApproved: true,
		status: state.status === "planning" ? "active" : state.status,
		executionState: state.runActive ? "in_progress" : (state.executionState ?? "idle"),
		milestones,
	}), "plan_updated", "Plan approved.");
}

export function invalidatePlan(state: GoalState): GoalState {
	const resetMilestones: readonly Milestone[] = state.milestones.map((m) =>
		({ ...m, status: "pending" as const }),
	);
	return withLifecycle(updateGoal(state, {
		planApproved: false,
		currentMilestoneIndex: 0,
		status: state.status === "complete" ? "active" : (state.status as GoalStatus),
		lastVerification: undefined,
		milestones: resetMilestones,
		milestoneRevision: (state.milestoneRevision ?? 0) + 1,
	}), "plan_updated", "Objective changed; plan and verification were invalidated.");
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

export function getRunMode(state: GoalState): GoalRunMode {
	return state.runMode ?? "manual";
}

export function withLifecycle(state: GoalState, kind: GoalLifecycleEvent["kind"], summary: string): GoalState {
	const event: GoalLifecycleEvent = {
		kind,
		timestamp: new Date().toISOString(),
		runId: state.runId,
		milestoneRevision: state.milestoneRevision,
		summary: summary.slice(0, 240),
	};
	return updateGoal(state, {
		lifecycle: [...(state.lifecycle ?? []), event].slice(-32),
	});
}

export function markProgress(state: GoalState, summary: string): GoalState {
	return withLifecycle(updateGoal(state, {
		lastProgressAt: new Date().toISOString(),
		livenessEpoch: (state.livenessEpoch ?? 0) + 1,
		livenessWarningIssued: false,
		livenessNudgeIssued: false,
	}), "progress", summary);
}

export function resumeRun(state: GoalState, turnBudget: number = state.turnBudget): GoalState {
	const consumedTurns = state.turnsUsed;
	const resumed = startRun(state, turnBudget, getRunMode(state));
	return markProgress(updateGoal(resumed, {
		turnsUsed: consumedTurns,
		turnBudget,
	}), "Goal run resumed without resetting turn accounting.");
}

export function startRun(state: GoalState, turnBudget: number, runMode: GoalRunMode = getRunMode(state)): GoalState {
	const started = updateGoal(state, {
		schemaVersion: 3,
		runMode,
		runId: `run-${randomUUID()}`,
		runStartedAt: new Date().toISOString(),
		executionState: "in_progress",
		status: "active",
		runActive: true,
		turnBudget,
		turnsUsed: 0,
		lastError: undefined,
		lastVerification: undefined,
		milestoneRevision: (state.milestoneRevision ?? 0) + 1,
		steeringContext: undefined,
	});
	return markProgress(withLifecycle(started, "run_started", `Started ${runMode} goal run.`), "Goal run started.");
}

export function stopGoal(state: GoalState, kind: "interrupted" | "failed", error?: string): GoalState {
	const next = updateGoal(state, {
		runActive: false,
		executionState: kind,
		lastError: error,
	});
	return withLifecycle(next, kind, error ?? "Goal run stopped.");
}

