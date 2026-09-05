/**
 * Shared types and path constants for pi-goal state.
 */
import { join } from "node:path";

export type GoalStatus = "active" | "paused" | "complete" | "planning";
export type GoalRunMode = "manual" | "continuous";
export type GoalExecutionState = "idle" | "in_progress" | "interrupted" | "failed" | "completed";

export type GoalLifecycleKind =
	| "run_started"
	| "plan_updated"
	| "progress"
	| "interrupted"
	| "failed"
	| "completed";

export interface GoalLifecycleEvent {
	readonly kind: GoalLifecycleKind;
	readonly timestamp: string;
	readonly runId?: string;
	readonly milestoneRevision?: number;
	readonly summary: string;
}

export interface Milestone {
	readonly id: string;
	readonly title: string;
	readonly validationCommand: string;
	readonly status: "pending" | "in_progress" | "done" | "blocked";
	readonly decisionNotes?: string;
}

export interface VerificationRecord {
	readonly goalId?: string;
	readonly milestoneIndex: number;
	readonly command: string;
	readonly exitCode: number;
	readonly outputSummary: string;
	readonly timestamp: string;
	readonly runId?: string;
	readonly milestoneRevision?: number;
}

export interface GoalExpectedCurrent {
	readonly goalId: string;
	readonly revision: number;
	readonly owner?: GoalOwnerIdentity;
}

export interface GoalOwnerIdentity {
	readonly token: string;
	readonly generation: number;
}

export interface GoalAdmission {
	readonly attempt: number;
	readonly generation: number;
}

export interface GoalReplacementReservation {
	readonly attempt: number;
	readonly generation: number;
	readonly revision: number;
}

export type GoalExpected = "absent" | GoalExpectedCurrent;

export interface GoalMutationApplied {
	readonly status: "applied";
	readonly previousRevision: number | "absent";
	readonly state: GoalState | null;
	readonly projection: "complete" | "failed";
	readonly projectionError?: string;
}

export interface GoalMutationConflict {
	readonly status: "conflict";
	readonly expected: GoalExpected;
	readonly actual: GoalState | null;
}

export type GoalMutationResult = GoalMutationApplied | GoalMutationConflict;

export interface GoalState {
	readonly schemaVersion: 1 | 2 | 3;
	readonly revision: number;
	readonly owner?: GoalOwnerIdentity;
	/** Highest generation ever claimed; retained across release to prevent ABA reuse. */
	readonly ownerGeneration?: number;
	readonly admission?: GoalAdmission;
	readonly replacement?: GoalReplacementReservation;
	readonly goalId: string;
	readonly objective: string;
	readonly sourcePath?: string;
	readonly status: GoalStatus;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly runId?: string;
	readonly runStartedAt?: string;
	readonly runMode?: GoalRunMode;
	readonly executionState?: GoalExecutionState;
	readonly runActive: boolean;
	readonly turnBudget: number;
	readonly turnsUsed: number;
	readonly lastError?: string;
	readonly completionEvidence?: string;
	readonly planRequired?: boolean;
	readonly planApproved?: boolean;
	readonly currentMilestoneIndex: number;
	readonly milestoneRevision?: number;
	readonly milestones: readonly Milestone[];
	readonly lastVerification?: VerificationRecord;
	readonly lastProgressAt?: string;
	readonly livenessEpoch?: number;
	readonly livenessWarningIssued?: boolean;
	readonly livenessNudgeIssued?: boolean;
	readonly steeringContext?: string;
	readonly lifecycle?: readonly GoalLifecycleEvent[];
	readonly changedFiles?: readonly string[];
}

interface GoalPaths {
	readonly dir: string;
	readonly statePath: string;
	readonly summaryPath: string;
	readonly todoPath: string;
	readonly specPath: string;
	readonly planPath: string;
	readonly statusPath: string;
	readonly runsPath: string;
}

export const STATE_DIR = join(".pi", "goal");
export const INSTANCES_DIR = join(STATE_DIR, "instances");
const STATE_FILE = "goal.json";
const SUMMARY_FILE = "GOAL.md";
const TODO_FILE = "TODO.md";
const SPEC_FILE = "SPEC.md";
const PLAN_FILE = "PLAN.md";
const STATUS_FILE = "STATUS.md";
const GOAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function assertGoalId(goalId: string): string {
	if (!GOAL_ID_PATTERN.test(goalId)) {
		throw new Error(`Invalid pi-goal id: ${goalId}`);
	}
	return goalId;
}

/** Returns either the legacy flat paths or a confined instance path set. */
export function goalPaths(cwd: string, goalId?: string): GoalPaths {
	const dir = goalId === undefined
		? join(cwd, STATE_DIR)
		: join(cwd, INSTANCES_DIR, assertGoalId(goalId));
	return {
		dir,
		statePath: join(dir, STATE_FILE),
		summaryPath: join(dir, SUMMARY_FILE),
		todoPath: join(dir, TODO_FILE),
		specPath: join(dir, SPEC_FILE),
		planPath: join(dir, PLAN_FILE),
		statusPath: join(dir, STATUS_FILE),
		runsPath: join(dir, "runs"),
	};
}
