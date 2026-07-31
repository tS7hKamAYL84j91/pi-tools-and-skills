/**
 * Goal state JSON parser and validation helpers.
 */
import type { GoalState, GoalStatus, Milestone, VerificationRecord } from "./goal-types.js";

export function parseGoalState(value: unknown): GoalState {
	if (!isRecord(value)) {
		throw new Error("Invalid goal state: expected object");
	}
	const storedVersion = readVersion(value.schemaVersion);
	const status = readStatus(value.status);

	const base: GoalState = {
		schemaVersion: storedVersion,
		goalId: readString(value.goalId, "goalId"),
		objective: readString(value.objective, "objective"),
		sourcePath: readOptionalString(value.sourcePath),
		status,
		createdAt: readString(value.createdAt, "createdAt"),
		updatedAt: readString(value.updatedAt, "updatedAt"),
		runId: readOptionalString(value.runId),
		runStartedAt: readOptionalString(value.runStartedAt),
		runActive: value.runActive === true,
		turnBudget: readNumber(value.turnBudget, "turnBudget"),
		turnsUsed: readNumber(value.turnsUsed, "turnsUsed"),
		lastError: readOptionalString(value.lastError),
		completionEvidence: readOptionalString(value.completionEvidence),
		planRequired: value.planRequired === true,
		planApproved: value.planApproved === true,
		currentMilestoneIndex: readOptionalNumber(value.currentMilestoneIndex) ?? 0,
		milestones: readMilestones(value.milestones),
		lastVerification: readVerification(value.lastVerification),
	};

	// Legacy v1 state without plan fields is treated as not requiring a plan.
	if (storedVersion === 1 && !value.planRequired) {
		return {
			...base,
			planRequired: false,
			planApproved: false,
			currentMilestoneIndex: 0,
			milestones: [],
			lastVerification: undefined,
		};
	}
	return base;
}

function readVersion(value: unknown): 1 | 2 {
	if (value === 1 || value === 2) return value;
	throw new Error(`Invalid goal state: unsupported schemaVersion=${String(value)}`);
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
		milestoneIndex: readNumber(value.milestoneIndex, "lastVerification.milestoneIndex"),
		command: readString(value.command, "lastVerification.command"),
		exitCode: typeof value.exitCode === "number" ? value.exitCode : Number.NaN,
		outputSummary: typeof value.outputSummary === "string" ? value.outputSummary : "",
		timestamp: typeof value.timestamp === "string" ? value.timestamp : new Date().toISOString(),
		runId: readOptionalString(value.runId),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
