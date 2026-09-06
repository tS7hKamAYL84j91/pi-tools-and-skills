/** Goal persistence, confined instances, legacy migration, and projections. */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { assertNoSymlinkComponents, assertSafeGoalRoot, ensureRuntimeIgnored, normalizeProjectPath, removeKnownRunArtifacts, assertSafeEntry } from "./goal-files.js";
import { randomUUID } from "node:crypto";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { migrateLegacyGoal } from "./goal-migration.js";
import { formatGoalDiagnostic } from "./goal-diagnostics.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	readGoalBinding,
	type GoalSessionScope,
} from "./goal-binding.js";
import {
	assertGoalId,
	goalPaths,
	type GoalExpected,
	type GoalMutationResult,
	type GoalState,
} from "./goal-types.js";
import {
	renderGoalMarkdown,
	renderIterationMarkdown,
} from "./goal-render.js";


/** Loads only the goal bound to this session scope. */
export async function loadGoal(cwd: string, scope?: GoalSessionScope): Promise<GoalState | null> {
	const scoped = scope?.sessionManager !== undefined;
	const goalId = scoped && scope ? await resolveScopedGoalId(scope) : undefined;
	if (scoped && goalId === undefined) return null;
	const paths = goalPaths(cwd, goalId);
	await assertSafeGoalRoot(cwd, goalId);
	return withAdvisoryLock(paths.statePath, async () => {
		await assertSafeGoalRoot(cwd, goalId);
		await assertSafeEntry(paths.statePath, "authority");
		if (!existsSync(paths.statePath)) return null;
		const raw = await readFile(paths.statePath, "utf8");
		// Malformed persisted state is intentionally surfaced; silently recovering could load the wrong goal.
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch (error: unknown) {
			throw error instanceof Error ? error : new Error(String(error));
		}
		const { parseGoalState } = await import("./goal-parse.js");
		const state = parseGoalState(parsed);
		if (goalId !== undefined && state.goalId !== goalId) { throw new Error("Goal authority does not match bound instance"); }
		await regenerateDerivedFiles(cwd, state, goalId);
		return state;
	});
}

export async function transactGoal(
	cwd: string,
	scope: GoalSessionScope | undefined,
	expected: GoalExpected,
	reducer: (current: GoalState | null) => GoalState | null,
	options?: { readonly allowOwnerChange?: boolean },
): Promise<GoalMutationResult> {
	const goalId = scope?.sessionManager ? await resolveScopedGoalId(scope) : undefined;
	if (scope?.sessionManager && goalId === undefined) return { status: "conflict", expected, actual: null };
	return transactGoalAt(cwd, goalId, expected, reducer, options);
}

export async function transactGoalAt(
	cwd: string,
	goalId: string | undefined,
	expected: GoalExpected,
	reducer: (current: GoalState | null) => GoalState | null,
	options?: { readonly allowOwnerChange?: boolean },
): Promise<GoalMutationResult> {
	const paths = goalPaths(cwd, goalId);
	await assertSafeGoalRoot(cwd, goalId);
	return withAdvisoryLock(paths.statePath, async () => {
		await assertSafeGoalRoot(cwd, goalId);
		await assertSafeEntry(paths.statePath, "authority");
		const current = await readAuthoritativeGoal(paths.statePath);
		if (goalId !== undefined && current !== null && current.goalId !== goalId) { throw new Error("Goal authority does not match bound instance"); }
		if (!matchesExpected(current, expected)) return { status: "conflict", expected, actual: current };
		const reduced = reducer(current);
		if (isPromiseLike(reduced)) throw new Error("Goal transaction reducer must be synchronous");
		if (reduced !== null) validateReducerOutput(current, reduced, options?.allowOwnerChange === true);
		if (!Number.isSafeInteger((current?.revision ?? 0) + 1)) { throw new Error("Goal revision exhausted; operator repair required"); }
		// Every terminal/operator stop revokes authority in the SAME revision commit.
		const revoked = reduced !== null && (!reduced.runActive || reduced.status !== "active");
		const next = reduced === null ? null : { ...reduced, ...(revoked ? { owner: undefined, admission: undefined, replacement: undefined } : {}), revision: (current?.revision ?? 0) + 1 };
		if (next === null) {
			await rm(paths.statePath, { force: true });
		} else {
			await writeFileAtomic(paths.statePath, `${JSON.stringify(next, null, 2)}\n`);
		}
		try {
			if (next === null) {
				const projectionPaths = [paths.summaryPath, paths.todoPath, paths.specPath, paths.planPath, paths.statusPath];
				for (const path of projectionPaths) await assertSafeEntry(path, "projection");
				await Promise.all(projectionPaths.map((path) => rm(path, { force: true })));
				await removeKnownRunArtifacts(paths.runsPath);
			} else {
				await regenerateDerivedFiles(cwd, next, goalId);
			}
			return { status: "applied", previousRevision: current?.revision ?? "absent", state: next, projection: "complete" };
		} catch (error: unknown) {
			return { status: "applied", previousRevision: current?.revision ?? "absent", state: next, projection: "failed", projectionError: formatGoalDiagnostic(error) };
		}
	});
}

function validateReducerOutput(current: GoalState | null, next: GoalState, allowOwnerChange = false): void {
	assertGoalId(next.goalId);
	if (current !== null && next.goalId !== current.goalId) {
		throw new Error("Goal transaction reducer cannot change goalId");
	}
	validateOwner(next.owner);
	if (current !== null && !sameOwner(current.owner, next.owner) && !allowOwnerChange) {
		throw new Error("Goal transaction reducer cannot change owner identity");
	}
}

function validateOwner(owner: GoalState["owner"]): void {
	if (owner === undefined) return;
	if (typeof owner.token !== "string" || owner.token.length === 0 || owner.token.length > 128 || !Number.isInteger(owner.generation) || owner.generation < 1) {
		throw new Error("Invalid goal owner identity");
	}
}

function sameOwner(left: GoalState["owner"], right: GoalState["owner"]): boolean {
	return left?.token === right?.token && left?.generation === right?.generation;
}

function matchesExpected(current: GoalState | null, expected: GoalExpected): boolean {
	if (expected === "absent") return current === null;
	return current !== null && current.goalId === expected.goalId && current.revision === expected.revision &&
		(expected.owner === undefined || (current.owner?.token === expected.owner.token && current.owner.generation === expected.owner.generation));
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

async function resolveScopedGoalId(scope: GoalSessionScope): Promise<string | undefined> {
	const binding = readGoalBinding(scope);
	if (binding !== undefined) {
		if (binding === null) return undefined;
		return assertGoalId(binding);
	}
	return migrateLegacyGoal(scope, {
		assertNoSymlinkComponents,
		assertSafeGoalRoot,
		regenerateDerivedFiles,
		ensureRuntimeIgnored,
	});
}

function requireScopedGoalId(scope: GoalSessionScope, expected: string): string {
	const binding = readGoalBinding(scope);
	if (binding === undefined) {
		throw new Error("This pi session has no usable pi-goal binding");
	}
	if (binding === null) {
		throw new Error("This pi session is unbound from pi-goal");
	}
	const goalId = assertGoalId(binding);
	if (goalId !== expected) {
		throw new Error("Goal state does not match the current pi session binding");
	}
	return goalId;
}

async function readAuthoritativeGoal(statePath: string): Promise<GoalState | null> {
	await assertSafeEntry(statePath, "authority");
	if (!existsSync(statePath)) return null;
	const raw = await readFile(statePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch (error: unknown) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	const { parseGoalState } = await import("./goal-parse.js");
	return parseGoalState(parsed);
}

async function regenerateDerivedFiles(cwd: string, state: GoalState, goalId?: string): Promise<void> {
	const paths = goalPaths(cwd, goalId);
	await mkdir(paths.dir, { recursive: true });
	await assertSafeEntry(paths.summaryPath, "projection");
	await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
}

export async function writeGoalIteration(
	cwd: string,
	state: GoalState,
	iteration: number,
	options: { readonly messages: readonly unknown[]; readonly scope?: GoalSessionScope },
): Promise<void> {
	const goalId = options.scope?.sessionManager ? requireScopedGoalId(options.scope, state.goalId) : undefined;
	const runId = assertGoalId(state.runId ?? "manual");
	const now = new Date();
	const dir = join(goalPaths(cwd, goalId).dir, "runs", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
	await assertSafeGoalRoot(cwd, goalId);
	await assertNoSymlinkComponents(cwd, dir);
	await mkdir(dir, { recursive: true });
	const prefix = `${runId}-iter-${String(iteration).padStart(3, "0")}`;
	await writeFileAtomic(join(dir, `${prefix}.jsonl`), `${options.messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
	await writeFileAtomic(join(dir, `${prefix}.md`), renderIterationMarkdown(state, iteration));
}

export async function createFileGoal(cwd: string, inputPath: string, scope?: GoalSessionScope): Promise<GoalState> {
	const { sourcePath, sourceRealPath } = await normalizeProjectPath(cwd, inputPath);
	if (!(await readFile(sourceRealPath, "utf8")).trim()) throw new Error(`Goal source file is empty: ${inputPath}`);
	return newGoal(`Complete the work described by ${sourcePath}`, sourcePath, scope);
}

export async function createTextGoal(_cwd: string, objective: string, scope?: GoalSessionScope): Promise<GoalState> {
	const cleaned = objective.trim();
	if (!cleaned) throw new Error("Goal text must be non-empty");
	return newGoal(cleaned, undefined, scope);
}

function newGoal(objective: string, sourcePath: string | undefined, _scope?: GoalSessionScope): GoalState {
	const now = new Date().toISOString();
	return {
		schemaVersion: 3,
		goalId: `g-${randomUUID()}`,
		revision: 0,
		objective,
		...(sourcePath ? { sourcePath } : {}),
		status: "active",
		runMode: "manual",
		executionState: "idle",
		createdAt: now,
		updatedAt: now,
		runActive: false,
		turnBudget: 0,
		turnsUsed: 0,
		currentMilestoneIndex: 0,
		milestoneRevision: 0,
		milestones: [],
		lastProgressAt: now,
		livenessEpoch: 0,
		livenessWarningIssued: false,
		livenessNudgeIssued: false,
		lifecycle: [],
		changedFiles: [],
	};
}
