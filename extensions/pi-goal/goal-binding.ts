/** Session-lineage binding and scoped persistence context for pi-goal. */

export const GOAL_BINDING_CUSTOM_TYPE = "pi-goal:binding";

export interface GoalSessionManager {
	readonly getBranch: () => readonly unknown[];
}

export interface GoalSessionScope {
	readonly cwd: string;
	readonly sessionManager?: GoalSessionManager;
	readonly appendBinding?: (goalId: string | null) => void | Promise<void>;
}

interface BindingEntry {
	readonly type?: unknown;
	readonly customType?: unknown;
	readonly data?: unknown;
}

interface BindingData {
	readonly goalId?: unknown;
}

/** Builds the narrow session capability used by production goal persistence. */
export function createGoalSessionScope(
	ctx: { readonly cwd: string; readonly sessionManager?: unknown },
	appendBinding?: (goalId: string | null) => void | Promise<void>,
): GoalSessionScope {
	const manager = isSessionManager(ctx.sessionManager) ? ctx.sessionManager : undefined;
	return { cwd: ctx.cwd, sessionManager: manager, appendBinding };
}

/** Returns the latest binding on the active session branch. */
export function readGoalBinding(scope: GoalSessionScope): string | null | undefined {
	if (!scope.sessionManager) return undefined;
	let binding: string | null | undefined;
	for (const entry of scope.sessionManager.getBranch()) {
		if (!isBindingEntry(entry)) continue;
		const data = entry.data;
		if (!isRecord(data) || (data.goalId !== null && typeof data.goalId !== "string")) continue;
		binding = data.goalId;
	}
	return binding;
}

/** Appends a private binding entry; null is the explicit unbound marker. */
export async function appendGoalBinding(scope: GoalSessionScope, goalId: string | null): Promise<void> {
	if (!scope.sessionManager) return;
	if (!scope.appendBinding) {
		throw new Error("This pi session cannot persist a pi-goal binding");
	}
	await scope.appendBinding(goalId);
}

function isSessionManager(value: unknown): value is GoalSessionManager {
	return isRecord(value) && typeof value.getBranch === "function";
}

function isBindingEntry(value: unknown): value is BindingEntry {
	if (!isRecord(value)) return false;
	return value.type === "custom" && value.customType === GOAL_BINDING_CUSTOM_TYPE;
}

function isRecord(value: unknown): value is Record<string, unknown> & BindingData {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
