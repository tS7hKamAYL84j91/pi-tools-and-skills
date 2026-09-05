/** Atomic ownership and send-admission primitives for a confined goal instance. */
import { randomUUID } from "node:crypto";
import type { GoalSessionScope } from "./goal-binding.js";
import { loadGoal, transactGoal } from "./goal-persist.js";
import type { GoalExpected, GoalOwnerIdentity, GoalMutationResult, GoalReplacementReservation } from "./goal-types.js";

interface GoalClaim {
	readonly token: string;
	readonly generation: number;
}

/** Claims an unowned goal. Existing claims never expire or get taken over. */
export async function claimGoal(
	cwd: string,
	scope?: GoalSessionScope,
	token: string = randomUUID(),
): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	if (current === null || current.owner !== undefined || !current.runActive || current.status !== "active") {
		return { status: "conflict", expected: current === null ? "absent" : { goalId: current.goalId, revision: current.revision }, actual: current };
	}
	const owner: GoalClaim = { token, generation: (current.ownerGeneration ?? 0) + 1 };
	if (!Number.isSafeInteger(owner.generation)) { throw new Error("Goal generation exhausted; operator repair required"); }
	return transactGoal(cwd, scope, { goalId: current.goalId, revision: current.revision }, (state) => state === null ? null : ({ ...state, owner, ownerGeneration: owner.generation }), { allowOwnerChange: true });
}

/** Records an admitted host send before invoking the host outside the lock. */
export async function reserveReplacement(
	cwd: string,
	scope: GoalSessionScope | undefined,
	owner: GoalOwnerIdentity,
	attempt: number,
): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	if (current === null) return { status: "conflict", expected: "absent", actual: null };
	if (current.owner?.token !== owner.token || current.owner.generation !== owner.generation || !current.runActive || attempt !== current.turnsUsed + 1) {
		return { status: "conflict", expected: { goalId: current.goalId, revision: current.revision, owner }, actual: current };
	}
	const reservation: GoalReplacementReservation = { attempt, generation: owner.generation, revision: current.revision + 1 };
	return transactGoal(cwd, scope, { goalId: current.goalId, revision: current.revision, owner }, (state) => state === null ? null : ({ ...state, replacement: reservation }));
}

export async function consumeReplacement(
	cwd: string,
	scope: GoalSessionScope | undefined,
	owner: GoalOwnerIdentity,
	attempt: number,
): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	const expected: GoalExpected = current === null ? "absent" : { goalId: current.goalId, revision: current.revision, owner };
	if (current === null || current.owner?.token !== owner.token || current.owner.generation !== owner.generation || !current.runActive || current.replacement?.attempt !== attempt || current.replacement.generation !== owner.generation || current.replacement.revision !== current.revision || attempt !== current.turnsUsed + 1) {
		return { status: "conflict", expected, actual: current };
	}
	return transactGoal(cwd, scope, expected, (state) => state === null ? null : ({ ...state, replacement: undefined, admission: { attempt, generation: owner.generation } }));
}

export async function admitGoal(
	cwd: string,
	scope: GoalSessionScope | undefined,
	owner: GoalOwnerIdentity,
	attempt: number,
): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	if (current === null) return { status: "conflict", expected: "absent", actual: null };
	if (current.owner === undefined || !current.runActive || current.replacement !== undefined || current.admission !== undefined || !Number.isSafeInteger(attempt) || attempt !== current.turnsUsed + 1) {
		return { status: "conflict", expected: { goalId: current.goalId, revision: current.revision, owner }, actual: current };
	}
	const expected: GoalExpected = { goalId: current.goalId, revision: current.revision, owner };
	return transactGoal(cwd, scope, expected, (state) => state === null ? null : ({ ...state, admission: { attempt, generation: owner.generation } }));
}

/** Invalidates a run generation; stale callbacks cannot subsequently admit work. */
export async function revokeGoal(cwd: string, scope: GoalSessionScope | undefined, owner: GoalOwnerIdentity): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	if (current === null) return { status: "conflict", expected: "absent", actual: null };
	return transactGoal(cwd, scope, { goalId: current.goalId, revision: current.revision, owner }, (state) => state === null ? null : ({ ...state, owner: undefined, admission: undefined, replacement: undefined, runActive: false, ownerGeneration: owner.generation }), { allowOwnerChange: true });
}

/** Releases only the exact owner identity and never clears a successor. */
export async function releaseGoal(cwd: string, scope: GoalSessionScope | undefined, owner: GoalOwnerIdentity): Promise<GoalMutationResult> {
	const current = await loadGoal(cwd, scope);
	if (current === null) return { status: "conflict", expected: "absent", actual: null };
	return transactGoal(cwd, scope, { goalId: current.goalId, revision: current.revision, owner }, (state) => state === null ? null : ({ ...state, owner: undefined, admission: undefined, replacement: undefined, runActive: false, ownerGeneration: owner.generation }), { allowOwnerChange: true });
}
