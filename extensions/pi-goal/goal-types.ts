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

export interface GoalState {
	readonly schemaVersion: 1 | 2 | 3;
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
}

export const STATE_DIR = join(".pi", "goal");
const STATE_FILE = "goal.json";
const SUMMARY_FILE = "GOAL.md";
const TODO_FILE = "TODO.md";
const SPEC_FILE = "SPEC.md";
const PLAN_FILE = "PLAN.md";
const STATUS_FILE = "STATUS.md";

export function goalPaths(cwd: string): GoalPaths {
	const dir = join(cwd, STATE_DIR);
	return {
		dir,
		statePath: join(dir, STATE_FILE),
		summaryPath: join(dir, SUMMARY_FILE),
		todoPath: join(dir, TODO_FILE),
		specPath: join(dir, SPEC_FILE),
		planPath: join(dir, PLAN_FILE),
		statusPath: join(dir, STATUS_FILE),
	};
}
