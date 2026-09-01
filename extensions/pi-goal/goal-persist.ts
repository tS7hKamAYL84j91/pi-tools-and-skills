/** Goal persistence, confined instances, legacy migration, and projections. */
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { withAdvisoryLock } from "../../lib/file-lock.js";
import { migrateLegacyGoal } from "./goal-migration.js";
import { writeFileAtomic } from "../../lib/file-persistence.js";
import {
	appendGoalBinding,
	readGoalBinding,
	type GoalSessionScope,
} from "./goal-binding.js";
import {
	assertGoalId,
	goalPaths,
	INSTANCES_DIR,
	STATE_DIR,
	type GoalState,
} from "./goal-types.js";
import {
	renderGoalMarkdown,
	renderIterationMarkdown,
	renderPlanMarkdown,
	renderSpecMarkdown,
	renderStatusMarkdown,
	renderTodoMarkdown,
} from "./goal-render.js";


/** Loads only the goal bound to this session scope. */
export async function loadGoal(cwd: string, scope?: GoalSessionScope): Promise<GoalState | null> {
	const scoped = scope?.sessionManager !== undefined;
	const goalId = scoped && scope ? await resolveScopedGoalId(scope) : undefined;
	if (scoped && goalId === undefined) return null;
	const paths = goalPaths(cwd, goalId);
	await assertSafeGoalRoot(cwd, goalId);
	return withAdvisoryLock(paths.statePath, async () => {
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
		if (state.schemaVersion === 3 && isLegacyState(parsed)) {
			await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
		}
		await regenerateDerivedFiles(cwd, state, goalId);
		return state;
	});
}

/** Saves an explicitly bound goal instance. The unscoped form is test/legacy compatibility only. */
export async function saveGoal(cwd: string, state: GoalState, scope?: GoalSessionScope): Promise<void> {
	const goalId = scope?.sessionManager ? requireScopedGoalId(scope, state.goalId) : undefined;
	const paths = goalPaths(cwd, goalId);
	await assertSafeGoalRoot(cwd, goalId);
	await withAdvisoryLock(paths.statePath, async () => {
		await mkdir(paths.dir, { recursive: true });
		await writeFileAtomic(paths.statePath, `${JSON.stringify(state, null, 2)}\n`);
		await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
		await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
		await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
		await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));
		await ensureRuntimeIgnored(cwd);
	});
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

function isLegacyState(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return value.schemaVersion === 1 || value.schemaVersion === 2 || typeof value.runMode !== "string" || typeof value.lastProgressAt !== "string";
}

async function regenerateDerivedFiles(cwd: string, state: GoalState, goalId?: string): Promise<void> {
	const paths = goalPaths(cwd, goalId);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.summaryPath, renderGoalMarkdown(state));
	await writeFileAtomic(paths.specPath, renderSpecMarkdown(state));
	await writeFileAtomic(paths.planPath, renderPlanMarkdown(state));
	await writeFileAtomic(paths.statusPath, renderStatusMarkdown(state));
}

export async function writeGoalIteration(
	cwd: string,
	state: GoalState,
	iteration: number,
	options: { readonly messages: readonly unknown[]; readonly scope?: GoalSessionScope },
): Promise<void> {
	const goalId = options.scope?.sessionManager ? requireScopedGoalId(options.scope, state.goalId) : undefined;
	const runId = state.runId ?? "manual";
	const now = new Date();
	const dir = join(goalPaths(cwd, goalId).dir, "runs", String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0"));
	await assertSafeGoalRoot(cwd, goalId);
	await mkdir(dir, { recursive: true });
	const prefix = `${runId}-iter-${String(iteration).padStart(3, "0")}`;
	await writeFileAtomic(join(dir, `${prefix}.jsonl`), `${options.messages.map((message) => JSON.stringify(message)).join("\n")}\n`);
	await writeFileAtomic(join(dir, `${prefix}.md`), renderIterationMarkdown(state, iteration));
}

export async function clearGoal(cwd: string, scope?: GoalSessionScope): Promise<void> {
	if (!scope) {
		await rm(goalPaths(cwd).dir, { recursive: true, force: true });
		return;
	}
	if (!scope.sessionManager) {
		await rm(goalPaths(cwd).dir, { recursive: true, force: true });
		return;
	}
	const goalId = readGoalBinding(scope);
	if (goalId === undefined) return;
	if (goalId === null) return;
	const validGoalId = assertGoalId(goalId);
	await assertSafeGoalRoot(cwd, validGoalId);
	await rm(goalPaths(cwd, validGoalId).dir, { recursive: true, force: true });
	await appendGoalBinding(scope, null);
}

export async function createFileGoal(cwd: string, inputPath: string, scope?: GoalSessionScope): Promise<GoalState> {
	const { sourcePath } = await normalizeProjectPath(cwd, inputPath);
	return newGoal(`Complete the work described by ${sourcePath}`, sourcePath, scope);
}

export async function createFileTodoGoal(cwd: string, inputPath: string, scope?: GoalSessionScope): Promise<GoalState> {
	const { sourcePath, sourceRealPath } = await normalizeProjectPath(cwd, inputPath);
	const content = (await readFile(sourceRealPath, "utf8")).trim();
	if (!content) throw new Error(`Goal source file is empty: ${inputPath}`);
	const objective = `Complete the work described by ${sourcePath}\n\n${content}`;
	const state = newGoal(`Complete the work described by ${sourcePath}`, sourcePath, scope);
	const paths = goalPaths(cwd, scope?.sessionManager ? state.goalId : undefined);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.todoPath, renderTodoMarkdown(objective));
	await ensureRuntimeIgnored(cwd);
	return updateSourcePath(state, relative(cwd, paths.todoPath));
}

export async function createTextGoal(cwd: string, objective: string, scope?: GoalSessionScope): Promise<GoalState> {
	const cleaned = objective.trim();
	if (!cleaned) throw new Error("Goal text must be non-empty");
	const state = newGoal(cleaned, undefined, scope);
	const paths = goalPaths(cwd, scope?.sessionManager ? state.goalId : undefined);
	await mkdir(paths.dir, { recursive: true });
	await writeFileAtomic(paths.todoPath, renderTodoMarkdown(cleaned));
	await ensureRuntimeIgnored(cwd);
	return updateSourcePath(state, relative(cwd, paths.todoPath));
}

function newGoal(objective: string, sourcePath: string | undefined, _scope?: GoalSessionScope): GoalState {
	const now = new Date().toISOString();
	return {
		schemaVersion: 3,
		goalId: `g-${randomUUID()}`,
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

function updateSourcePath(state: GoalState, sourcePath: string): GoalState {
	return { ...state, sourcePath };
}

function isConfinedPath(root: string, target: string): boolean {
	const pathFromRoot = relative(root, target);
	return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

interface NormalizedProjectPath { readonly sourcePath: string; readonly sourceRealPath: string; }

async function normalizeProjectPath(cwd: string, inputPath: string): Promise<NormalizedProjectPath> {
	const cleaned = inputPath.startsWith("@") ? inputPath.slice(1) : inputPath;
	const projectPath = resolve(cwd);
	const absolute = resolve(projectPath, cleaned);
	const rel = relative(projectPath, absolute);
	if (rel === "" || !isConfinedPath(projectPath, absolute)) throw new Error(`Goal source must be inside the project: ${inputPath}`);
	let current = projectPath;
	for (const part of rel.split(/[\\/]+/).filter((segment) => segment.length > 0)) {
		current = join(current, part);
		const info = await lstat(current).catch((error: unknown) => {
			if (isErrorCode(error, "ENOENT")) throw new Error(`Goal source file does not exist: ${inputPath}`);
			throw error;
		});
		if (info.isSymbolicLink()) throw new Error(`Goal source must not contain symlink components: ${inputPath}`);
	}
	const [projectRealPath, sourceRealPath] = await Promise.all([realpath(projectPath), realpath(absolute)]);
	if (!isConfinedPath(projectRealPath, sourceRealPath) || sourceRealPath === projectRealPath) throw new Error(`Goal source must resolve inside the project: ${inputPath}`);
	return { sourcePath: rel, sourceRealPath };
}

async function assertSafeGoalRoot(cwd: string, goalId?: string): Promise<void> {
	const root = resolve(cwd, STATE_DIR);
	await assertNoSymlinkComponents(cwd, root);
	if (goalId !== undefined) {
		assertGoalId(goalId);
		await assertNoSymlinkComponents(cwd, resolve(cwd, INSTANCES_DIR));
		await assertNoSymlinkComponents(cwd, goalPaths(cwd, goalId).dir);
	}
}

async function assertNoSymlinkComponents(cwd: string, target: string): Promise<void> {
	const project = resolve(cwd);
	const absolute = resolve(target);
	if (!isConfinedPath(project, absolute)) throw new Error(`pi-goal path escapes the project: ${target}`);
	const rel = relative(project, absolute);
	let current = project;
	for (const part of rel.split(/[\\/]+/).filter(Boolean)) {
		current = join(current, part);
		const info = await lstat(current).catch((error: unknown) => isErrorCode(error, "ENOENT") ? undefined : Promise.reject(error));
		if (info?.isSymbolicLink()) throw new Error(`pi-goal path contains a symlink: ${current}`);
	}
}

async function ensureRuntimeIgnored(cwd: string): Promise<void> {
	const gitExclude = join(cwd, ".git", "info", "exclude");
	if (!existsSync(dirname(gitExclude))) return;
	let current = "";
	if (existsSync(gitExclude)) current = await readFile(gitExclude, "utf8");
	const ignoredPath = `${STATE_DIR}/`;
	if (current.split(/\r?\n/).includes(ignoredPath)) return;
	const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
	await writeFileAtomic(gitExclude, `${current}${prefix}${ignoredPath}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorCode(error: unknown, code: string): boolean {
	return isRecord(error) && error.code === code;
}
