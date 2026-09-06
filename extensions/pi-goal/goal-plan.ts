/**
 * Goal execution transitions and cleanup of historical plan state.
 */
import { randomUUID } from "node:crypto";
import type {
	GoalLifecycleEvent,
	GoalRunMode,
	GoalState,
} from "./goal-types.js";

/** Remove obsolete plan/approval state before direct execution. */
export function removePlan(state: GoalState): GoalState {
	if (!state.planRequired && state.milestones.length === 0) return state;
	return withLifecycle(updateGoal(state, {
		planRequired: false,
		planApproved: false,
		currentMilestoneIndex: 0,
		milestones: [],
		lastVerification: undefined,
		status: state.status === "planning" ? "active" : state.status,
		milestoneRevision: (state.milestoneRevision ?? 0) + 1,
	}), "plan_updated", "Removed legacy plan gate; goal now executes directly.");
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

function getRunMode(state: GoalState): GoalRunMode {
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
