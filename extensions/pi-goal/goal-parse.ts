/**
 * Goal state JSON parser and validation helpers.
 */
import type {
	GoalExecutionState,
	GoalLifecycleEvent,
	GoalRunMode,
	GoalState,
	GoalStatus,
	Milestone,
	VerificationRecord,
} from "./goal-types.js";

export function parseGoalState(value: unknown): GoalState {
	if (!isRecord(value)) {
		throw new Error("Invalid goal state: expected object");
	}
	const storedVersion = readVersion(value.schemaVersion);
	const status = readStatus(value.status);
	const executionState = readExecutionState(value.executionState) ?? inferExecutionState(status, value.runActive === true);
	const runMode = readRunMode(value.runMode) ?? "manual";

	const base: GoalState = {
		schemaVersion: 3,
		goalId: readString(value.goalId, "goalId"),
		objective: readString(value.objective, "objective"),
		sourcePath: readOptionalString(value.sourcePath),
		status,
		createdAt: readString(value.createdAt, "createdAt"),
		updatedAt: readString(value.updatedAt, "updatedAt"),
		runId: readOptionalString(value.runId),
		runStartedAt: readOptionalString(value.runStartedAt),
		runMode: runMode,
		executionState,
		runActive: value.runActive === true,
		turnBudget: readNumber(value.turnBudget, "turnBudget"),
		turnsUsed: readNumber(value.turnsUsed, "turnsUsed"),
		lastError: readOptionalString(value.lastError),
		completionEvidence: readOptionalString(value.completionEvidence),
		planRequired: value.planRequired === true,
		planApproved: value.planApproved === true,
		currentMilestoneIndex: readOptionalNumber(value.currentMilestoneIndex) ?? 0,
		milestoneRevision: readOptionalNumber(value.milestoneRevision) ?? (storedVersion < 3 ? 1 : 0),
		milestones: readMilestones(value.milestones),
		lastVerification: storedVersion >= 3 ? readVerification(value.lastVerification) : undefined,
		lastProgressAt: readOptionalString(value.lastProgressAt) ?? readOptionalString(value.updatedAt) ?? readOptionalString(value.createdAt),
		livenessEpoch: readOptionalNumber(value.livenessEpoch) ?? 0,
		livenessWarningIssued: value.livenessWarningIssued === true,
		livenessNudgeIssued: value.livenessNudgeIssued === true,
		steeringContext: readOptionalString(value.steeringContext),
		lifecycle: readLifecycle(value.lifecycle),
		changedFiles: readStringArray(value.changedFiles, 20),
	};
	return base;
}

function readVersion(value: unknown): 1 | 2 | 3 {
	if (value === 1 || value === 2 || value === 3) return value;
	throw new Error(`Invalid goal state: unsupported schemaVersion=${String(value)}`);
}

function readRunMode(value: unknown): GoalRunMode | undefined {
	return value === "manual" || value === "continuous" ? value : undefined;
}

function readExecutionState(value: unknown): GoalExecutionState | undefined {
	if (value === "idle" || value === "in_progress" || value === "interrupted" || value === "failed" || value === "completed") {
		return value;
	}
	return undefined;
}

function inferExecutionState(status: GoalStatus, runActive: boolean): GoalExecutionState {
	if (status === "complete") return "completed";
	if (runActive) return "in_progress";
	if (status === "paused") return "interrupted";
	return "idle";
}

function readStatus(value: unknown): GoalStatus {
	if (
		value === "active" ||
		value === "paused" ||
		value === "complete" ||
		value === "planning"
	) {
		return value;
	}
	throw new Error(`Invalid goal state: status=${String(value)}`);
}

function readString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid goal state: ${field} must be a non-empty string`);
	}
	return value;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new Error(`Invalid goal state: ${field} must be a non-negative integer`);
	}
	return value;
}

function readOptionalNumber(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		return undefined;
	}
	return value;
}

function readMilestones(value: unknown): readonly Milestone[] {
	if (!Array.isArray(value)) return [];
	return value.map((item, index) => readMilestone(item, index));
}

function readMilestone(value: unknown, index: number): Milestone {
	if (!isRecord(value)) {
		throw new Error(`Invalid goal state: milestone[${index}] must be an object`);
	}
	const status = value.status;
	if (
		status !== "pending" &&
		status !== "in_progress" &&
		status !== "done" &&
		status !== "blocked"
	) {
		throw new Error(`Invalid goal state: milestone[${index}] status=${String(status)}`);
	}
	return {
		id: readString(value.id, `milestone[${index}].id`),
		title: readString(value.title, `milestone[${index}].title`),
		validationCommand: readString(value.validationCommand, `milestone[${index}].validationCommand`),
		status,
		decisionNotes: readOptionalString(value.decisionNotes),
	};
}

function readVerification(value: unknown): VerificationRecord | undefined {
	if (!isRecord(value)) return undefined;
	return {
		goalId: readOptionalString(value.goalId),
		milestoneIndex: readNumber(value.milestoneIndex, "lastVerification.milestoneIndex"),
		command: readString(value.command, "lastVerification.command"),
		exitCode: typeof value.exitCode === "number" ? value.exitCode : Number.NaN,
		outputSummary: typeof value.outputSummary === "string" ? value.outputSummary : "",
		timestamp: typeof value.timestamp === "string" ? value.timestamp : new Date().toISOString(),
		runId: readOptionalString(value.runId),
		milestoneRevision: readOptionalNumber(value.milestoneRevision),
	};
}

function readLifecycle(value: unknown): readonly GoalLifecycleEvent[] {
	if (!Array.isArray(value)) return [];
	return value.slice(-32).flatMap((item) => {
		if (!isRecord(item) || typeof item.kind !== "string" || typeof item.timestamp !== "string" || typeof item.summary !== "string") return [];
		if (!["run_started", "plan_updated", "progress", "interrupted", "failed", "completed"].includes(item.kind)) return [];
		return [{
			kind: item.kind as GoalLifecycleEvent["kind"],
			timestamp: item.timestamp,
			runId: readOptionalString(item.runId),
			milestoneRevision: readOptionalNumber(item.milestoneRevision),
			summary: item.summary.slice(0, 240),
		}];
	});
}

function readStringArray(value: unknown, maxItems: number): readonly string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string").slice(0, maxItems).map((item) => item.slice(0, 160));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
